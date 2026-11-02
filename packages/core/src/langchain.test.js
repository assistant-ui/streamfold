import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool } from "./index.js";
import { langchain } from "./langchain.js";

test("LangChain keeps empty arguments separate from interleaved JSON and preserves completion order", () => {
  for (const method of ["push", "pushAll"]) {
    const pool = createStructuredStreamPool();
    const stream = langchain(pool);
    stream[method]({ tool_call_chunks: [
      { id: "paris", index: 0, args: "" },
      { id: "tokyo", args: '{"city":' },
      { id: "unindexed-empty" },
      { id: "indexed-empty", index: 1, args: " \n" },
    ] });
    const partial = stream[method]({ tool_call_chunks: [{ index: 0, args: '{"city":"Pa' }] });
    assert.deepEqual((method === "push" ? partial : partial[0]).partialValue, { city: "Pa" });
    stream[method]({ tool_call_chunks: [
      { index: 0, args: 'ris"}' },
      { id: "tokyo", args: '"Tokyo"}' },
      { index: 0, args: " \t" },
    ] });
    assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [
      { id: "paris", value: { city: "Paris" } },
      { id: "indexed-empty", value: {} },
      { id: "tokyo", value: { city: "Tokyo" } },
      { id: "unindexed-empty", value: {} },
    ]);
    assert.equal(pool.size, 0);
    assert.equal(stream.finish().length, 4);
  }
});

test("LangChain empty arguments complete with immutable value patches", () => {
  const stream = langchain(createStructuredStreamPool({ snapshots: "immutable" }));
  const initial = stream.pushAll({ tool_call_chunks: [{ id: "weather", args: " " }] })[0];
  assert.equal(initial.partialValue, undefined);
  const [completed] = stream.finish();
  assert.deepEqual(completed.value, {});
  assert.ok(Object.isFrozen(completed.value));
  assert.deepEqual(completed.changes, [
    { op: "set", path: [], value: {} },
    { op: "complete", path: [] },
  ]);
  assert.equal(initial.partialValue, undefined);
});

test("LangChain empty argument fallback preserves validation and byte limits", () => {
  for (const [limits, text, code] of [
    [{}, '{"city":', "INCOMPLETE_JSON"],
    [{}, '{"city":invalid}', "INVALID_JSON"],
    [{ maxBytes: 1 }, "", "MAX_BYTES_EXCEEDED"],
    [{ maxBytes: 2 }, "   ", "MAX_BYTES_EXCEEDED"],
  ]) {
    const pool = createStructuredStreamPool(limits);
    const stream = langchain(pool);
    stream.pushAll({ tool_call_chunks: [{ id: "weather", index: 0 }] });
    assert.throws(() => {
      stream.pushAll({ tool_call_chunks: [{ index: 0, args: text }] });
      stream.finish();
    }, { code, id: "weather", adapter: "langchain" });
    assert.equal(pool.size, 0);
    assert.throws(() => stream.finish(), { code });
  }
});
