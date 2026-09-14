import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { createStructuredStream, createStructuredStreamPool } from "./index.js";

const assertFrozen = (value) => {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertFrozen(child);
};

test("immutable snapshots preserve history and share unchanged branches", () => {
  const stream = createStructuredStream({ snapshots: "immutable" });
  const first = stream.push(
    '{"stable":{"ok":true},"rows":[{"name":"a',
  ).partialValue;
  const second = stream.push('b"},{"name":"c"}').partialValue;
  assert.deepEqual(first, { stable: { ok: true }, rows: [{ name: "a" }] });
  assert.deepEqual(second.rows, [{ name: "ab" }, { name: "c" }]);
  assert.notEqual(first, second);
  assert.equal(first.stable, second.stable);
  assert.notEqual(first.rows, second.rows);
  assert.notEqual(first.rows[0], second.rows[0]);
  const third = stream.push(',{"name":"d"}]}').partialValue;
  assert.equal(second.rows[0], third.rows[0]);
  assert.equal(second.rows[1], third.rows[1]);
  assert.equal(stream.finish().partialValue, third);
  assert.equal(stream.state.partialValue, third);
  assert.equal(stream.value, third);
  assert.equal(stream.getFieldState(["rows", 2, "name"]), "complete");
  for (const value of [first, second, third]) assertFrozen(value);
  assert.throws(() => {
    first.rows[0].name = "changed";
  }, TypeError);
  assert.throws(() => {
    second.rows.push({});
  }, TypeError);
  stream.dispose();
});

test("immutable duplicate keys replace values and invalidate field completion", () => {
  const stream = createStructuredStream({ snapshots: "immutable" });
  const first = stream.push('{"a":{"old":true},"a":').partialValue;
  const second = stream.push('{"new":"par').partialValue;
  assert.deepEqual(first, { a: { old: true } });
  assert.deepEqual(second, { a: { new: "par" } });
  assert.equal(stream.getFieldState(["a"]), "partial");
  assert.equal(stream.getFieldState(["a", "old"]), "partial");
  stream.push('tial"}}');
  assert.equal(stream.getFieldState(["a"]), "complete");
  assert.deepEqual(second, { a: { new: "par" } });
  stream.dispose();
});

test("immutable snapshots handle special keys and every Unicode chunk boundary", () => {
  const text =
    '{"__proto__":{"polluted":true},"constructor":{"name":"x"},"items":[1,true,null,"\\uD83D\\uDE80","é\uD83D\uDE80"]}';
  for (let split = 0; split <= text.length; split++) {
    const stream = createStructuredStream({ snapshots: "immutable" });
    const first = stream.push(text.slice(0, split)).partialValue;
    const saved = structuredClone(first);
    stream.push(text.slice(split));
    const final = stream.finish().partialValue;
    assert.deepEqual(final, JSON.parse(text));
    assert.deepEqual(first, saved);
    assert.equal(Object.getPrototypeOf(final), Object.prototype);
    assert.equal(Object.hasOwn(final, "__proto__"), true);
    assertFrozen(final);
    stream.dispose();
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test("immutable prefixes match live mode across generated chunk schedules", () => {
  fc.assert(
    fc.property(
      fc.jsonValue(),
      fc.integer({ min: 1, max: 32 }),
      (value, chunkSize) => {
        const text = JSON.stringify(value);
        const live = createStructuredStream();
        const immutable = createStructuredStream({ snapshots: "immutable" });
        const history = [];
        try {
          for (let offset = 0; offset < text.length; offset += chunkSize) {
            const chunk = text.slice(offset, offset + chunkSize);
            const snapshot = immutable.push(chunk).partialValue;
            assert.deepEqual(snapshot, live.push(chunk).partialValue);
            assertFrozen(snapshot);
            history.push([snapshot, structuredClone(snapshot)]);
          }
          assert.deepEqual(immutable.finish().partialValue, JSON.parse(text));
          for (const [snapshot, saved] of history)
            assert.deepEqual(snapshot, saved);
        } finally {
          live.dispose();
          immutable.dispose();
        }
      },
    ),
    { numRuns: 100, seed: 513 },
  );
});

test("pools freeze both final and partial values in immutable mode", () => {
  const pool = createStructuredStreamPool({ snapshots: "immutable" });
  const first = pool.start("a", '{"rows":[').partialValue;
  pool.start("b", "42");
  pool.push("a", '{"ok":true}]}');
  const final = pool.finish("a");
  assert.deepEqual(first, { rows: [] });
  assert.deepEqual(final.partialValue, final.value);
  assertFrozen(final.value);
  assertFrozen(final.partialValue);
  assert.equal(pool.finish("b").value, 42);
  assert.equal(pool.size, 0);
});

test("live snapshots remain the default and invalid modes fail clearly", () => {
  for (const options of [{}, { snapshots: "live" }]) {
    const stream = createStructuredStream(options);
    const first = stream.push('{"name":"a').partialValue;
    const second = stream.push('b"}').partialValue;
    assert.equal(first, second);
    assert.deepEqual(first, { name: "ab" });
    assert.equal(Object.isFrozen(first), false);
    stream.dispose();
  }
  assert.throws(() => createStructuredStream({ snapshots: "typo" }), {
    name: "TypeError",
  });
});
