import assert from "node:assert/strict";
import test from "node:test";
import { AssistantTransportDecoder, UIMessageStreamDecoder, createAssistantStream } from "assistant-stream";
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

for (const format of ["native", "ui"]) {
  for (const [kind, text] of [["no", undefined], ["complete", "{}"], ["incomplete", '{"city":']]) {
    test(`${format} SDK decoder error endings reject ${kind} pending arguments`, async () => {
      const events = format === "native" ? [
        ...(text === undefined ? [] : [
          { type: "part-start", path: [], part: { type: "tool-call", toolCallId: "weather", toolName: "weather" } },
          { type: "text-delta", path: [0], textDelta: text },
        ]),
        { type: "message-finish", path: [], finishReason: "error", usage: { inputTokens: 1, outputTokens: 1 } },
      ] : [
        { type: "start", messageId: "message" },
        ...(text === undefined ? [] : [
          { type: "tool-input-start", toolCallId: "weather", toolName: "weather" },
          { type: "tool-input-delta", toolCallId: "weather", inputTextDelta: text },
        ]),
        { type: "finish", finishReason: "error" },
      ];
      const wire = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
      const decoded = new Response(wire).body.pipeThrough(
        format === "native" ? new AssistantTransportDecoder() : new UIMessageStreamDecoder(),
      );
      const chunks = [];
      for await (const chunk of decoded) chunks.push(chunk);
      let closed = false;
      let readPastFailure = false;
      function* source() {
        try {
          for (const chunk of chunks) {
            yield chunk;
            if (chunk.type === "message-finish") readPastFailure = true;
          }
        } finally { closed = true; }
      }
      const completed = [];
      await assert.rejects(async () => {
        for await (const update of readStructured(source(), { integration: assistantUI })) {
          if (update.type === "complete") completed.push(update);
        }
      }, (error) => {
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.message, "Assistant generation failed");
        assert.equal(error.adapter, "assistant-ui");
        assert.equal(error.eventType, "message-finish");
        assert.equal(error.cause.type, "message-finish");
        assert.equal(error.cause.finishReason, "error");
        return true;
      });
      assert.deepEqual(completed, []);
      assert.equal(closed, true);
      assert.equal(readPastFailure, false);
      assert.equal(decoded.locked, false);
    });
  }
}

test("assistant-ui failed endings abort pending calls and stay terminal", () => {
  for (const method of ["push", "pushAll"]) {
    for (const type of ["step-finish", "message-finish"]) {
      const pool = createStructuredStreamPool();
      const diagnostics = [];
      const stream = assistantUI(pool, { onDiagnostic: (event) => diagnostics.push(event) });
      for (const [index, text] of ["{}", '{"city":'].entries()) {
        stream[method]({ type: "part-start", path: [], part: { type: "tool-call", toolCallId: String(index), toolName: "weather" } });
        stream[method]({ type: "text-delta", path: [index], textDelta: text });
      }
      const event = { type, path: [], finishReason: "error", usage: { inputTokens: 1, outputTokens: 1 }, isContinued: false };
      let failure;
      assert.throws(() => stream[method](event), (error) => {
        failure = error;
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.eventType, type);
        assert.equal(error.cause, event);
        return true;
      });
      assert.equal(pool.size, 0);
      assert.throws(() => stream.finish(), (error) => error === failure);
      assert.throws(() => stream[method]({ type: "tool-call-args-text-finish", path: [0] }), (error) => error === failure);
      assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
      assert.equal(diagnostics[0].error, failure);
    }
  }
});

test("non-error endings preserve tool completion timing and validation", () => {
  for (const finishReason of ["stop", "tool-calls", "length", "content-filter", "other", "unknown"]) {
    for (const text of ["{}", '{"city":']) {
      const pool = createStructuredStreamPool();
      const stream = assistantUI(pool);
      stream.pushAll({ type: "part-start", path: [], part: { type: "tool-call", toolCallId: "weather", toolName: "weather" } });
      stream.pushAll({ type: "text-delta", path: [0], textDelta: text });
      assert.deepEqual(stream.pushAll({ type: "step-finish", path: [], finishReason }), []);
      assert.deepEqual(stream.pushAll({ type: "message-finish", path: [], finishReason }), []);
      assert.equal(pool.size, 1);
      const complete = () => stream.pushAll({ type: "tool-call-args-text-finish", path: [0] });
      if (text === "{}") {
        assert.deepEqual(complete().map(({ type, id, value }) => ({ type, id, value })), [
          { type: "complete", id: "weather", value: {} },
        ]);
      } else {
        assert.throws(complete, { code: "INCOMPLETE_JSON" });
      }
      assert.equal(pool.size, 0);
    }
  }
});

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
