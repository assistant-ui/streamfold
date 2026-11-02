import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { agUI } from "./ag-ui.js";

const start = (toolCallId) => ({ type: "TOOL_CALL_START", toolCallId });
const args = (toolCallId, delta) => ({ type: "TOOL_CALL_ARGS", toolCallId, delta });
const failureEvent = { type: "RUN_ERROR", message: "Provider unavailable", code: "provider_error" };

test("AG-UI run failures release pending calls and remain terminal", () => {
  for (const method of ["push", "pushAll"]) {
    const pool = createStructuredStreamPool();
    const diagnostics = [];
    const stream = agUI(pool, { onDiagnostic: (event) => diagnostics.push(event) });
    stream[method](start("complete-json"));
    stream[method](args("complete-json", "{}"));
    stream[method](start("partial-json"));
    stream[method](args("partial-json", '{"city":'));
    let failure;
    assert.throws(() => stream[method](failureEvent), (error) => {
      failure = error;
      assert.equal(error.message, "Provider unavailable");
      assert.equal(error.code, "INTEGRATION_ERROR");
      assert.equal(error.adapter, "ag-ui");
      assert.equal(error.eventType, "RUN_ERROR");
      assert.equal(error.cause, failureEvent);
      return true;
    });
    assert.equal(pool.size, 0);
    assert.throws(() => stream.finish(), (error) => error === failure);
    assert.throws(() => stream[method]({ type: "TOOL_CALL_END", toolCallId: "complete-json" }), (error) => error === failure);
    assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
    assert.equal(diagnostics[0].error, failure);
  }
});

test("managed AG-UI run failures close the source without completing pending arguments", async () => {
  let closed = false;
  let readPastFailure = false;
  const events = (async function* () {
    try {
      yield start("weather");
      yield args("weather", '{"city":"Paris"}');
      yield failureEvent;
      readPastFailure = true;
    } finally {
      closed = true;
    }
  })();
  const completed = [];
  await assert.rejects(async () => {
    for await (const update of readStructured(events, { integration: agUI })) {
      if (update.type === "complete") completed.push(update);
    }
  }, { message: "Provider unavailable", code: "INTEGRATION_ERROR" });
  assert.deepEqual(completed, []);
  assert.equal(closed, true);
  assert.equal(readPastFailure, false);
});

test("AG-UI preserves successful argument completion and ignores tool execution results", () => {
  const stream = agUI();
  stream.pushAll({ type: "RUN_STARTED", threadId: "thread", runId: "run" });
  stream.pushAll(start("weather"));
  stream.pushAll(args("weather", '{"city":"Paris"}'));
  assert.equal(stream.pushAll({ type: "TOOL_CALL_END", toolCallId: "weather" })[0].type, "complete");
  assert.deepEqual(stream.pushAll({ type: "TOOL_CALL_RESULT", toolCallId: "weather", content: "Tool unavailable", role: "tool" }), []);
  assert.deepEqual(stream.pushAll({ type: "RUN_FINISHED", threadId: "thread", runId: "run" }), []);
  assert.deepEqual(stream.finish().map(({ value }) => value), [{ city: "Paris" }]);
});
