import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { vercelAI } from "./vercel-ai.js";

test("Vercel failed generation endings release pending calls and remain terminal", () => {
  for (const method of ["push", "pushAll"]) {
    for (const type of ["finish-step", "finish"]) {
      const pool = createStructuredStreamPool();
      const diagnostics = [];
      const stream = vercelAI(pool, { onDiagnostic: (value) => diagnostics.push(value) });
      stream[method]({ type: "start-step" });
      for (const [id, delta] of [["complete-json", "{}"], ["partial-json", '{"city":']]) {
        stream[method]({ type: "tool-input-start", id });
        stream[method]({ type: "tool-input-delta", id, delta });
      }
      const event = { type, finishReason: "error", rawFinishReason: "provider_error" };
      let failure;
      assert.throws(() => stream[method](event), (error) => {
        failure = error;
        assert.equal(error.message, "Vercel AI generation failed");
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.adapter, "vercel-ai");
        assert.equal(error.eventType, type);
        assert.equal(error.cause, event);
        return true;
      });
      assert.equal(pool.size, 0);
      assert.throws(() => stream.finish(), (error) => error === failure);
      assert.throws(() => stream[method]({ type: "finish", finishReason: "stop" }), (error) => error === failure);
      assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
      assert.equal(diagnostics[0].error, failure);
    }
  }
});

test("Vercel reasonless step boundaries defer pending calls without delaying final inputs", () => {
  for (const ending of [{ type: "finish", finishReason: "stop" }, { type: "finish" }, undefined]) {
    const pool = createStructuredStreamPool();
    const stream = vercelAI(pool);
    stream.pushAll({ type: "start-step" });
    stream.pushAll({ type: "tool-input-start", toolCallId: "pending" });
    stream.pushAll({ type: "tool-input-delta", toolCallId: "pending", inputTextDelta: '{"city":"Paris"}' });
    assert.deepEqual(stream.pushAll({ type: "finish-step" }), []);
    assert.equal(pool.size, 1);
    stream.pushAll({ type: "start-step" });
    const available = stream.pushAll({ type: "tool-input-available", toolCallId: "final", input: { location: "Tokyo" } });
    assert.deepEqual(available.map(({ type, id }) => [type, id]), [["start", "final"], ["complete", "final"]]);
    assert.deepEqual(available.at(-1).value, { location: "Tokyo" });
    assert.deepEqual(stream.pushAll({ type: "finish-step" }), []);
    if (ending !== undefined) {
      assert.deepEqual(stream.pushAll(ending).map(({ type, id, value }) => ({ type, id, value })), [
        { type: "complete", id: "pending", value: { city: "Paris" } },
      ]);
    }
    assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [
      { id: "final", value: { location: "Tokyo" } },
      { id: "pending", value: { city: "Paris" } },
    ]);
    assert.equal(pool.size, 0);
    if (ending !== undefined) assert.deepEqual(stream.pushAll(ending), []);
  }
});

test("Vercel provider and input errors terminate the session and release all calls", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const method of ["push", "pushAll"]) {
      for (const event of [
        { type: "error", error: new Error("provider failed") },
        { type: "error", error: "provider failed" },
        { type: "error", error: { message: "provider failed" } },
        { type: "error", errorText: "provider failed" },
        { type: "error" },
        { type: "tool-input-error", toolCallId: "a", errorText: "invalid input" },
        { type: "tool-input-error", toolCallId: "a" },
        { type: "tool-call", toolCallId: "a", invalid: true, error: new Error("invalid input"), input: {} },
        { type: "tool-call", toolCallId: "a", invalid: true, input: {} },
      ]) {
        const pool = createStructuredStreamPool({ snapshots });
        const diagnostics = [];
        const stream = vercelAI(pool, { onDiagnostic: (value) => diagnostics.push(value) });
        stream[method]({ type: "start-step" });
        for (const id of ["a", "b"]) {
          stream[method]({ type: "tool-input-start", id });
          stream[method]({ type: "tool-input-delta", id, delta: "{}" });
        }
        let failure;
        assert.throws(() => stream[method](event), (error) => {
          failure = error;
          if (event.error instanceof Error) assert.equal(error, event.error);
          assert.equal(error.code, "INTEGRATION_ERROR");
          assert.equal(error.adapter, "vercel-ai");
          assert.equal(error.eventType, event.type);
          assert.equal(error.id, event.toolCallId);
          assert.equal(error.message, event.errorText ?? event.error?.message ?? event.error ?? "Vercel AI stream failed");
          return true;
        });
        assert.equal(pool.size, 0);
        assert.throws(() => stream[method]({ type: "finish-step" }), (error) => error === failure);
        assert.throws(() => stream.finish(), (error) => error === failure);
        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0].code, "STREAM_ERROR");
        assert.equal(diagnostics[0].error, failure);
        assert.equal(diagnostics[0].id, event.toolCallId);
      }
    }
  }
});

test("Vercel preserves frozen upstream errors while closing managed sources", async () => {
  for (const snapshots of ["live", "immutable"]) {
    const failure = Object.freeze(new Error("provider failed"));
    let closed = false;
    const events = (async function* () {
      try {
        yield { type: "start-step" };
        yield { type: "tool-input-start", id: "a" };
        yield { type: "tool-input-delta", id: "a", delta: "{}" };
        yield { type: "error", error: failure };
        assert.fail("the source must close after a provider error");
      } finally {
        closed = true;
      }
    })();
    const completed = [];
    await assert.rejects(async () => {
      for await (const update of readStructured(events, { integration: vercelAI, limits: { snapshots } })) {
        if (update.type === "complete") completed.push(update);
      }
    }, (error) => error === failure);
    assert.deepEqual(completed, []);
    assert.equal(closed, true);
  }
});

test("Vercel input parsing leaves tool execution outcomes to the application", () => {
  const stream = vercelAI();
  const [start, complete] = stream.pushAll({ type: "tool-call", toolCallId: "a", input: {}, invalid: false });
  assert.equal(start.type, "start");
  assert.equal(complete.type, "complete");
  for (const type of ["tool-error", "tool-output-error", "tool-output-denied"]) {
    assert.deepEqual(stream.pushAll({ type, toolCallId: "a", error: new Error("execution failed"), errorText: "execution failed" }), []);
  }
  assert.deepEqual(stream.finish().map(({ value }) => value), [{}]);
});

test("Vercel abort events release pending calls and remain terminal", () => {
  for (const method of ["push", "pushAll"]) {
    for (const event of [{ type: "abort", reason: "cancelled by user" }, { type: "abort" }]) {
      const pool = createStructuredStreamPool();
      const diagnostics = [];
      const stream = vercelAI(pool, { onDiagnostic: (value) => diagnostics.push(value) });
      stream[method]({ type: "start-step" });
      for (const [id, delta] of [["complete-json", "{}"], ["partial-json", '{"city":']]) {
        stream[method]({ type: "tool-input-start", id });
        stream[method]({ type: "tool-input-delta", id, delta });
      }
      let failure;
      assert.throws(() => stream[method](event), (error) => {
        failure = error;
        assert.equal(error.message, event.reason ?? "Vercel AI stream aborted");
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.adapter, "vercel-ai");
        assert.equal(error.eventType, "abort");
        assert.equal(error.cause, event);
        return true;
      });
      assert.equal(pool.size, 0);
      assert.throws(() => stream.finish(), (error) => error === failure);
      assert.throws(() => stream[method]({ type: "finish-step" }), (error) => error === failure);
      assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
      assert.equal(diagnostics[0].error, failure);
    }
  }
});
