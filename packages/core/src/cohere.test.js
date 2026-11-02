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

test("Cohere failure endings release pending calls even without an error message", () => {
  for (const method of ["push", "pushAll"]) {
    for (const details of [
      { finishReason: "ERROR" },
      { finish_reason: "TIMEOUT" },
      { finishReason: "TIMEOUT", error: "provider deadline expired" },
      { finish_reason: "ERROR", error: "" },
    ]) {
      const pool = createStructuredStreamPool();
      const diagnostics = [];
      const stream = cohere(pool, { onDiagnostic: (event) => diagnostics.push(event) });
      stream[method](start(0, "complete-json", "{}"));
      stream[method](start(1, "partial-json", '{"city":'));
      const reason = details.finishReason ?? details.finish_reason;
      let failure;
      assert.throws(() => stream[method]({ type: "message-end", delta: details }), (error) => {
        failure = error;
        assert.equal(error.message, details.error || `Cohere generation failed: ${reason}`);
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.adapter, "cohere");
        assert.equal(error.eventType, "message-end");
        assert.equal(error.cause, details);
        return true;
      });
      assert.equal(pool.size, 0);
      assert.throws(() => stream.finish(), (error) => error === failure);
      assert.throws(() => stream[method](end(0)), (error) => error === failure);
      assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
      assert.equal(diagnostics[0].error, failure);
    }
  }
});
