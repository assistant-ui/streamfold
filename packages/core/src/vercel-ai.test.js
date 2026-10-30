import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { vercelAI } from "./vercel-ai.js";

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
