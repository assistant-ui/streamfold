import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { createStructuredStream, createStructuredStreamPool } from "./index.js";
import { createAssistantStreamBackend } from "./internal/assistant-stream.js";
import { createToolInputParser } from "./vercel-ai.js";

const modes = ["live", "immutable"];

const nested = (depth, leaf) => {
  let value = leaf;
  for (let level = 1; level < depth; level++) value = [value];
  return value;
};

const isDeepFrozen = (value) => {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (!Object.isFrozen(current)) return false;
    pending.push(...Object.values(current));
  }
  return true;
};

test("a push that opens and closes the root reports one root set, not a patch per value", () => {
  const depth = 127;
  const count = 20_000;
  const text = "[".repeat(depth) + Array(count).fill(1).join(",") + "]".repeat(depth);
  const expected = nested(depth, Array(count).fill(1));
  for (const snapshots of modes) {
    const stream = createStructuredStream({ snapshots });
    const update = stream.push(text);
    assert.equal(update.complete, true);
    assert.equal(update.changes.length, 2);
    assert.deepEqual(update.changes, [
      { op: "set", path: [], value: expected },
      { op: "complete", path: [] },
    ]);
    assert.deepEqual(update.partialValue, expected);
    assert.equal(stream.getFieldState([...Array(depth - 1).fill(0), count - 1]), "complete");
    assert.deepEqual(stream.finish().changes, []);
    stream.dispose();
  }
});

test("pool finish with different final text reports the replacement as one root set", () => {
  const depth = 64;
  const count = 5_000;
  const text = "[".repeat(depth) + Array(count).fill(1).join(",") + "]".repeat(depth);
  for (const snapshots of modes) {
    const pool = createStructuredStreamPool({ snapshots });
    pool.start("a", "[[1");
    const result = pool.finish("a", text);
    assert.equal(result.changes.length, 2);
    assert.deepEqual(result.changes.map(({ op, path }) => [op, path]), [["set", []], ["complete", []]]);
    assert.deepEqual(result.value, nested(depth, Array(count).fill(1)));
  }
});

test("a whole-document set value is never shared with the partial value", () => {
  const text = '{"a":{"b":[1,{"c":"x"}]},"d":"e"}';
  for (const snapshots of modes) {
    const stream = createStructuredStream({ snapshots });
    const { changes, partialValue } = stream.push(text);
    const value = changes[0].value;
    assert.notEqual(value, partialValue);
    assert.notEqual(value.a, partialValue.a);
    assert.notEqual(value.a.b[1], partialValue.a.b[1]);
    assert.equal(Object.isFrozen(value), false);
    assert.equal(isDeepFrozen(partialValue), snapshots === "immutable");
    if (snapshots === "live") {
      value.a.b[1].c = "changed";
      value.a.b.push(2);
      assert.deepEqual(partialValue, JSON.parse(text));
    }
    stream.dispose();
  }
});

test("whole-document values match JSON.parse for duplicate keys, special keys, and escapes", () => {
  for (const text of [
    '{"a":1,"a":{"b":2},"a":"x"}',
    '{"__proto__":{"polluted":true},"constructor":{"prototype":1}}',
    '{"2":2,"1":1,"nested":{"10":"ten","0":"zero"}}',
    '{"s":"line\\nfeed \\" \\\\ \\u00e9 \\uD83D\\uDE00 \\uD800","n":[-0,1e400,2.5E-3,-12]}',
    ' [ [] , {} , [[]] , "" , true , false , null ] ',
  ]) {
    const expected = JSON.parse(text);
    for (const snapshots of modes) {
      const stream = createStructuredStream({ snapshots });
      const { changes, partialValue } = stream.push(text);
      assert.equal(changes.length, 2, text);
      assert.deepEqual(changes[0].value, expected, text);
      assert.deepEqual(partialValue, expected, text);
      assert.deepEqual(Object.keys(partialValue), Object.keys(expected), text);
      assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
      stream.dispose();
    }
  }
});

test("whole-document values match per-value patches for generated JSON", () => {
  fc.assert(
    fc.property(fc.jsonValue({ maxDepth: 6 }), fc.integer({ min: 1, max: 16 }), (json, size) => {
      const text = JSON.stringify(json);
      for (const snapshots of modes) {
        const whole = createStructuredStream({ snapshots });
        const chunked = createStructuredStream({ snapshots });
        const update = whole.push(text);
        for (let index = 0; index < text.length; index += size) {
          chunked.push(text.slice(index, index + size));
        }
        const expected = whole.finish().partialValue;
        assert.deepEqual(expected, chunked.finish().partialValue);
        if (text[0] === "{" || text[0] === "[") {
          assert.equal(update.changes.length, 2);
          assert.deepEqual(update.changes[0].value, expected);
        }
        whole.dispose();
        chunked.dispose();
      }
    }),
    { numRuns: 300 },
  );
});

test("pushes that leave the root open, close an earlier root, or carry a scalar root keep per-value patches", () => {
  const open = createStructuredStream();
  assert.deepEqual(open.push('[1,{"a":true}').changes, [
    { op: "set", path: [], value: [] },
    { op: "set", path: [0], value: 1 },
    { op: "complete", path: [0] },
    { op: "set", path: [1], value: {} },
    { op: "set", path: [1, "a"], value: true },
    { op: "complete", path: [1, "a"] },
    { op: "complete", path: [1] },
  ]);
  assert.deepEqual(open.push(',"x"]').changes, [
    { op: "set", path: [2], value: "" },
    { op: "append", path: [2], value: "x" },
    { op: "complete", path: [2] },
    { op: "complete", path: [] },
  ]);
  open.dispose();

  const scalar = createStructuredStream();
  assert.deepEqual(scalar.push('"whole"').changes, [
    { op: "set", path: [], value: "" },
    { op: "append", path: [], value: "whole" },
    { op: "complete", path: [] },
  ]);
  scalar.dispose();
});

test("whole-document pushes deeper than the call stack build and copy iteratively", () => {
  const depth = 10_000;
  for (const snapshots of modes) {
    const stream = createStructuredStream({ snapshots, maxDepth: depth });
    const update = stream.push("[".repeat(depth) + "]".repeat(depth));
    assert.equal(update.changes.length, 2);
    let value = update.partialValue;
    let copy = update.changes[0].value;
    for (let level = 1; level < depth; level++) {
      assert.notEqual(value, copy);
      value = value[0];
      copy = copy[0];
    }
    assert.deepEqual(value, []);
    assert.deepEqual(copy, []);
    stream.dispose();
  }
});

test("unsafe keys inside a whole-document push are still rejected", () => {
  for (const text of [
    '{"a":{"__proto__":{"polluted":true}},"tail":1}',
    '{"a":[{"constructor":{"prototype":{"polluted":true}}}]}',
  ]) {
    const parser = createToolInputParser();
    assert.throws(() => parser.push(text), /unsafe key/);
    assert.throws(() => parser.push(""), { code: "STREAM_DISPOSED" });
    // A rejected backend returns undefined so assistant-stream parses natively.
    const backend = createAssistantStreamBackend({
      text,
      fallback: {},
      createSnapshot: (value) => value,
    });
    assert.equal(backend, undefined, text);
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  }
  const safe = createAssistantStreamBackend({
    text: '{"constructor":{"name":"x"},"prototype":1}',
    fallback: {},
    createSnapshot: (value) => value,
  });
  assert.deepEqual(safe.currentArgs, { constructor: { name: "x" }, prototype: 1 });
});
