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

test("Vercel tool inputs without argument text complete as empty objects", () => {
  const summary = (updates) => updates.map(({ type, id, value }) => ({ type, id, value }));
  for (const deltas of [[], [""], [" ", "\n"]]) {
    // Outside SDK steps, tool-input-end completes; the later tool-call is a repeat.
    const pool = createStructuredStreamPool();
    const stream = vercelAI(pool);
    stream.pushAll({ type: "tool-input-start", id: "no-args", toolName: "now" });
    for (const delta of deltas) stream.pushAll({ type: "tool-input-delta", id: "no-args", delta });
    assert.deepEqual(summary(stream.pushAll({ type: "tool-input-end", id: "no-args" })), [
      { type: "complete", id: "no-args", value: {} },
    ]);
    assert.deepEqual(stream.pushAll({ type: "tool-call", toolCallId: "no-args", toolName: "now", input: {} }), []);
    assert.equal(pool.size, 0);

    // Inside SDK steps, a call closed by tool-input-end completes at a finish
    // reason or EOF without a tool-call event, even when the step was truncated.
    for (const ending of [
      { type: "finish-step", finishReason: "tool-calls" },
      { type: "finish-step", finishReason: "length" },
      { type: "finish-step", finishReason: "content-filter" },
      { type: "finish", finishReason: "tool-calls" },
      undefined,
    ]) {
      const pool = createStructuredStreamPool();
      const stream = vercelAI(pool);
      stream.pushAll({ type: "start-step" });
      stream.pushAll({ type: "tool-input-start", id: "no-args", toolName: "now" });
      for (const delta of deltas) stream.pushAll({ type: "tool-input-delta", id: "no-args", delta });
      assert.deepEqual(stream.pushAll({ type: "tool-input-end", id: "no-args" }), []);
      const completed = ending === undefined ? stream.finish() : stream.pushAll(ending);
      assert.deepEqual(completed.map(({ id, text, value }) => ({ id, text, value })), [{ id: "no-args", text: "{}", value: {} }]);
      assert.equal(pool.size, 0);
    }
  }
});

test("Vercel fails closed when a step or stream ends before an empty tool input closes", async () => {
  const endings = [
    ...["stop", "tool-calls", "length", "content-filter", "interrupted", "other"].flatMap((finishReason) => [
      [{ type: "finish-step", finishReason }],
      [{ type: "finish", finishReason }],
    ]),
    // UI streams omit the step reason and have no tool-input-end; finish or EOF decides.
    [{ type: "finish-step" }, { type: "finish" }],
    [{ type: "finish-step" }],
    [],
  ];
  for (const method of ["push", "pushAll"]) {
    for (const deltas of [[], [""], [" ", "\n"]]) {
      for (const ending of endings) {
        const diagnostics = [];
        const pool = createStructuredStreamPool();
        const stream = vercelAI(pool, { onDiagnostic: (event) => diagnostics.push(event) });
        stream[method]({ type: "start-step" });
        stream[method]({ type: "tool-input-start", id: "other", toolName: "weather" });
        stream[method]({ type: "tool-input-delta", id: "other", delta: '{"city":"Paris"}' });
        stream[method]({ type: "tool-input-start", id: "no-args", toolName: "now" });
        for (const delta of deltas) stream[method]({ type: "tool-input-delta", id: "no-args", delta });
        const closing = ending.find((event) => event.type === "finish" || event.finishReason !== undefined);
        for (const event of ending.filter((event) => event !== closing)) assert.deepEqual(stream.pushAll(event), []);
        let failure;
        assert.throws(() => (closing === undefined ? stream.finish() : stream[method](closing)), (error) => {
          failure = error;
          assert.equal(error.code, "INTEGRATION_ERROR");
          assert.equal(error.id, "no-args");
          assert.equal(error.adapter, "vercel-ai");
          if (closing !== undefined) {
            assert.equal(error.cause, closing);
            const reason = closing.finishReason === undefined ? "" : ` \\(${closing.finishReason}\\)`;
            assert.match(error.message, new RegExp(`${closing.type}${reason} arrived before tool call no-args`));
          } else {
            assert.match(error.message, /stream ended before tool call no-args/);
          }
          return true;
        });
        assert.equal(pool.size, 0);
        assert.throws(() => stream.finish(), (error) => error === failure);
        assert.deepEqual(diagnostics.map(({ code, id }) => ({ code, id })), [{ code: "STREAM_ERROR", id: "no-args" }]);
      }
    }
  }
  for (const snapshots of ["live", "immutable"]) {
    for (const ending of [[], [{ type: "finish-step", finishReason: "length" }]]) {
      const completed = [];
      await assert.rejects(async () => {
        for await (const update of readStructured(
          [{ type: "start-step" }, { type: "tool-input-start", id: "no-args", toolName: "now" }, ...ending],
          { integration: vercelAI, limits: { snapshots } },
        )) {
          if (update.type === "complete") completed.push(update);
        }
      }, { code: "INTEGRATION_ERROR", id: "no-args", adapter: "vercel-ai" });
      assert.deepEqual(completed, []);
    }
  }
});

test("Vercel final inputs stay authoritative after empty argument text", () => {
  const stream = vercelAI();
  stream.pushAll({ type: "start-step" });
  stream.pushAll({ type: "tool-input-start", id: "weather", toolName: "weather" });
  stream.pushAll({ type: "tool-input-end", id: "weather" });
  const [completed] = stream.pushAll({ type: "tool-call", toolCallId: "weather", toolName: "weather", input: { units: "celsius" } });
  assert.deepEqual(completed.value, { units: "celsius" });
  stream.pushAll({ type: "finish-step", finishReason: "tool-calls" });
  assert.deepEqual(stream.finish().map(({ value }) => value), [{ units: "celsius" }]);

  const partial = vercelAI();
  partial.pushAll({ type: "tool-input-start", id: "partial" });
  partial.pushAll({ type: "tool-input-delta", id: "partial", delta: " " });
  partial.pushAll({ type: "tool-input-delta", id: "partial", delta: '{"city":' });
  assert.throws(() => partial.pushAll({ type: "tool-input-end", id: "partial" }), { code: "INCOMPLETE_JSON" });
});
