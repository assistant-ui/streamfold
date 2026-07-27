import assert from "node:assert/strict";
import test from "node:test";
import { parsePartialJson } from "ai";
import { createStructuredStream } from "../packages/core/src/index.js";

const fixtures = [
  {
    value: {
      city: "San Francisco",
      days: 3,
      active: true,
      missing: null,
    },
  },
  {
    value: {
      query: 'a "quoted" value\nwith a second line',
      emoji: "👋",
    },
  },
  {
    value: {
      items: [
        { id: 1, score: -12.5e2, enabled: false },
        { id: 2, score: 0.25, enabled: true },
      ],
    },
  },
  {
    input: '{"escapedEmoji":"\\uD83D\\uDC4B","slash":"a\\/b"}',
    value: { escapedEmoji: "👋", slash: "a/b" },
  },
];

test("matches Vercel partial JSON values at every character boundary", async () => {
  for (const fixture of fixtures) {
    const input = fixture.input ?? JSON.stringify(fixture.value);
    const stream = createStructuredStream();
    let accumulated = "";

    for (const character of input) {
      accumulated += character;
      const update = stream.push(character);
      const expected = await parsePartialJson(accumulated);
      assert.deepEqual(
        update.partialValue,
        expected.value,
        `prefix ${JSON.stringify(accumulated)}`,
      );
    }

    assert.deepEqual(stream.finish().partialValue, fixture.value);
    stream.dispose();
  }
});

test("emits compact path patches instead of complete replacement values", () => {
  const stream = createStructuredStream();

  assert.deepEqual(stream.push('{"tool":{"query":"San').changes, [
    { op: "set", path: [], value: {} },
    { op: "set", path: ["tool"], value: {} },
    { op: "set", path: ["tool", "query"], value: "" },
    { op: "append", path: ["tool", "query"], value: "San" },
  ]);

  assert.deepEqual(stream.push(' Francisco","limit":1').changes, [
    { op: "append", path: ["tool", "query"], value: " Francisco" },
    { op: "complete", path: ["tool", "query"] },
    { op: "set", path: ["tool", "limit"], value: 1 },
  ]);
  assert.deepEqual(stream.value, {
    tool: { query: "San Francisco", limit: 1 },
  });

  stream.push("0}}");
  assert.deepEqual(stream.finish().partialValue, {
    tool: { query: "San Francisco", limit: 10 },
  });
  stream.dispose();
});

test("tracks field completion without cloning the partial value", () => {
  const stream = createStructuredStream();

  assert.equal(stream.getFieldState(["query"]), "partial");
  stream.push('{"query":"first","query":"sec');
  assert.equal(stream.getFieldState(["query"]), "partial");

  stream.push('ond","nested":{"value":12');
  assert.equal(stream.getFieldState(["query"]), "complete");
  assert.equal(stream.getFieldState(["nested"]), "partial");
  assert.equal(stream.getFieldState(["nested", "value"]), "partial");

  stream.push("}}");
  assert.equal(stream.getFieldState(["nested"]), "complete");
  assert.equal(stream.getFieldState(["nested", "value"]), "complete");
  assert.equal(stream.getFieldState(["missing"]), "complete");
  stream.dispose();

  const numericKey = createStructuredStream();
  numericKey.push('{"items":[{"1":"done","next":"');
  assert.equal(numericKey.getFieldState(["items", 0, 1]), "complete");
  assert.equal(numericKey.getFieldState(["items", 0, "next"]), "partial");
  numericKey.dispose();
});

test("treats object keys as data without prototype mutation", () => {
  const stream = createStructuredStream();
  const input =
    '{"__proto__":{"polluted":true},"constructor":{"safe":"yes"}}';
  const update = stream.push(input);

  assert.equal(Object.getPrototypeOf(update.partialValue), Object.prototype);
  assert.equal(Object.hasOwn(update.partialValue, "__proto__"), true);
  assert.deepEqual(update.partialValue.__proto__, { polluted: true });
  assert.deepEqual(update.partialValue.constructor, { safe: "yes" });
  assert.equal({}.polluted, undefined);

  stream.dispose();
});

test("rejects malformed JSON before final materialization", () => {
  for (const input of [
    '{"trailing":true,}',
    '{"leadingZero":01}',
    '{"escape":"\\x"}',
    '{"literal":truX}',
    "[1,]",
  ]) {
    const stream = createStructuredStream();
    assert.throws(() => stream.push(input), SyntaxError, input);
    stream.dispose();
  }
});
