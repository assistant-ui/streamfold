import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool } from "./index.js";
import { cohere } from "./cohere.js";

const start = (index, id, args = "") => ({ type: "tool-call-start", index, delta: { message: { tool_calls: { id, function: { arguments: args } } } } });
const delta = (index, args) => ({ type: "tool-call-delta", index, delta: { message: { tool_calls: { function: { arguments: args } } } } });
const end = (index) => ({ type: "tool-call-end", index });

test("Cohere handles decoded wire arguments and finalizes each call once", () => {
  const stream = cohere();
  stream.push(start(0, "first", '{"city":'));
  stream.push(delta(0, '"Paris"}'));
  assert.deepEqual(stream.pushAll(end(0)).map(({ id, value }) => ({ id, value })), [{ id: "first", value: { city: "Paris" } }]);
  assert.deepEqual(stream.pushAll(end(0)), []);
  stream.push(start(0, "second", "{}"));
  assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [{ id: "first", value: { city: "Paris" } }, { id: "second", value: {} }]);
});

test("Cohere releases active calls on truncated arguments, limits, or provider errors", () => {
  for (const [options, input, ending, expected] of [
    [{}, '{"city":', end(0), /complete|incomplete/i],
    [{ maxBytes: 4 }, '{"city":"Paris"}', end(0), /maxBytes/],
    [{}, '{}', { type: "message-end", delta: { error: "generation failed" } }, /generation failed/],
  ]) {
    const pool = createStructuredStreamPool(options);
    const stream = cohere(pool);
    stream.push(start(0, "first"));
    stream.push(start(1, "second"));
    assert.throws(() => { stream.push(delta(0, input)); stream.push(ending); }, expected);
    assert.equal(pool.size, 0);
    assert.throws(() => stream.finish(), expected);
  }
});

test("Cohere ignores text and diagnoses uncorrelated argument events", () => {
  const diagnostics = [];
  const stream = cohere(undefined, { onDiagnostic: (value) => diagnostics.push(value) });
  assert.deepEqual(stream.pushAll({ type: "content-delta", delta: { message: { content: { text: "Hello" } } } }), []);
  stream.push(delta(9, "{}"));
  stream.push({ type: "tool-call-start", delta: { message: { tool_calls: { id: "missing-index" } } } });
  assert.deepEqual(stream.finish(), []);
  assert.equal(diagnostics.filter(({ code }) => code === "UNMATCHED_TOOL_EVENT").length, 2);
});
