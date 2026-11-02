import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantStream } from "assistant-stream";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { assistantUI } from "./assistant-ui.js";

const collect = async (source) => {
  const updates = [];
  for await (const update of readStructured(source, {
    integration: assistantUI,
    limits: { snapshots: "immutable" },
  })) updates.push(update);
  return updates;
};

test("SDK tool arguments stay separate after text and reasoning parts", async () => {
  const updates = await collect(createAssistantStream(async (controller) => {
    controller.appendText("Checking two cities.");
    controller.appendReasoning("Compare their forecasts.");
    const weather = controller.addToolCallPart({ toolName: "weather", toolCallId: "weather" });
    const forecast = controller.addToolCallPart({ toolName: "forecast", toolCallId: "forecast" });
    weather.argsText.append('{"city":"San');
    forecast.argsText.append('{"days":2}');
    await forecast.close();
    weather.argsText.append(' Francisco"}');
    await weather.close();
  }));

  assert.deepEqual(updates.filter(({ type }) => type === "start").map(({ id }) => id), ["weather", "forecast"]);
  assert.deepEqual(updates.filter(({ type, id }) => type === "update" && id === "weather").map(({ partialValue }) => partialValue), [
    { city: "San" }, { city: "San Francisco" },
  ]);
  const completed = updates.filter(({ type }) => type === "complete");
  assert.equal(completed.length, 2);
  assert.deepEqual(Object.fromEntries(completed.map(({ id, value }) => [id, value])), {
    weather: { city: "San Francisco" }, forecast: { days: 2 },
  });
});

test("merged SDK streams route remapped indexes and empty tool arguments", async () => {
  const updates = await collect(createAssistantStream((controller) => {
    controller.appendData({ type: "data", name: "context", data: { ready: true } });
    controller.merge(createAssistantStream(async (child) => {
      const tool = child.addToolCallPart({ toolName: "clock", toolCallId: "clock" });
      await tool.close();
    }));
    controller.merge(createAssistantStream(async (child) => {
      child.appendText("Checking Paris.");
      const tool = child.addToolCallPart({ toolName: "weather", toolCallId: "weather", args: { city: "Paris" } });
      await tool.close();
    }));
  }));

  const completed = updates.filter(({ type }) => type === "complete");
  assert.equal(completed.length, 2);
  assert.deepEqual(Object.fromEntries(completed.map(({ id, value }) => [id, value])), {
    clock: {}, weather: { city: "Paris" },
  });
});

for (const pending of [false, true]) {
  test(`SDK callback failures reject ${pending ? "pending arguments" : "an empty stream"}`, async () => {
    const source = createAssistantStream((controller) => {
      if (pending) {
        const call = controller.addToolCallPart({ toolName: "weather", toolCallId: "weather" });
        call.argsText.append('{"city":"Paris"}');
      }
      throw new Error("provider unavailable");
    });
    const completed = [];
    await assert.rejects(async () => {
      for await (const update of readStructured(source, { integration: assistantUI })) {
        if (update.type === "complete") completed.push(update);
      }
    }, (error) => {
      assert.equal(error.message, "Error: provider unavailable");
      assert.equal(error.code, "INTEGRATION_ERROR");
      assert.equal(error.eventType, "error");
      assert.deepEqual(error.cause, { type: "error", path: [], error: "Error: provider unavailable" });
      return true;
    });
    assert.deepEqual(completed, []);
    assert.equal(source.locked, false);
  });
}

test("assistant-ui stream errors release all pending calls and remain terminal", () => {
  for (const method of ["push", "pushAll"]) {
    const pool = createStructuredStreamPool();
    const diagnostics = [];
    const stream = assistantUI(pool, { onDiagnostic: (event) => diagnostics.push(event) });
    for (const [index, text] of ["{}", '{"city":'].entries()) {
      stream[method]({ type: "part-start", path: [], part: { type: "tool-call", toolCallId: String(index), toolName: "weather" } });
      stream[method]({ type: "text-delta", path: [index], textDelta: text });
    }
    const event = { type: "error", path: [], error: "provider unavailable", code: "unavailable", severity: "critical" };
    let failure;
    assert.throws(() => stream[method](event), (error) => {
      failure = error;
      assert.equal(error.message, event.error);
      assert.equal(error.code, "INTEGRATION_ERROR");
      assert.equal(error.adapter, "assistant-ui");
      assert.equal(error.cause, event);
      return true;
    });
    assert.equal(pool.size, 0);
    assert.throws(() => stream.finish(), (error) => error === failure);
    assert.throws(() => stream[method]({ type: "tool-call-args-text-finish", path: [0] }), (error) => error === failure);
    assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
    assert.equal(diagnostics[0].error, failure);
  }
});

test("tool execution errors do not turn valid arguments into stream failures", async () => {
  const source = createAssistantStream(async (controller) => {
    const call = controller.addToolCallPart({ toolName: "weather", toolCallId: "weather", args: { city: "Paris" } });
    await call.setResponse({ result: "service unavailable", isError: true });
  });
  const results = [];
  const observed = (async function* () {
    for await (const event of source) {
      if (event.type === "result") results.push({ result: event.result, isError: event.isError });
      yield event;
    }
  })();
  const updates = await collect(observed);
  assert.deepEqual(results, [{ result: "service unavailable", isError: true }]);
  assert.deepEqual(updates.filter(({ type }) => type === "complete").map(({ value }) => value), [{ city: "Paris" }]);
});
