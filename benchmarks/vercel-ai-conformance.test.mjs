import assert from "node:assert/strict";
import test from "node:test";
import { streamText, tool } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { readStructured } from "../packages/core/src/index.js";
import { vercelAI } from "../packages/core/src/vercel-ai.js";

const sdkToolCall = (streamed, inputSchema = z.object({ city: z.string() }), {
  input = '{"city":"Paris"}', failure,
} = {}) => {
  const chunks = [
    { type: "stream-start", warnings: [] },
    ...(streamed ? [
      { type: "tool-input-start", id: "weather-1", toolName: "weather" },
      { type: "tool-input-delta", id: "weather-1", delta: input },
      ...(failure ? [] : [{ type: "tool-input-end", id: "weather-1" }]),
    ] : []),
    failure ? { type: "error", error: failure }
      : { type: "tool-call", toolCallId: "weather-1", toolName: "weather", input },
    {
      type: "finish",
      finishReason: { unified: failure ? "error" : "tool-calls", raw: failure ? "error" : "tool_calls" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
  return streamText({
    model: new MockLanguageModelV4({ doStream: {
      stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
    } }),
    prompt: "Weather in Paris?",
    tools: { weather: tool({ description: "Get weather", inputSchema }) },
    onError() {},
  });
};

async function readSdkToolCall(streamed, inputSchema = z.object({ city: z.string() }), format = "ui") {
  const result = sdkToolCall(streamed, inputSchema);
  const updates = [];
  const source = format === "full" ? result.fullStream : result.toUIMessageStream();
  for await (const update of readStructured(source, { integration: vercelAI })) {
    if (update.type === "complete") updates.push({ id: update.id, value: update.value });
  }
  return updates;
}

test("streamed SDK arguments produce a completed tool input", async () => {
  assert.deepEqual(await readSdkToolCall(true), [{ id: "weather-1", value: { city: "Paris" } }]);
});

for (const streamed of [false, true]) {
  test(`fullStream preserves final inputs ${streamed ? "after" : "without"} deltas`, async () => {
    assert.deepEqual(await readSdkToolCall(streamed, z.object({
      city: z.string(),
      units: z.string().default("celsius"),
    }), "full"), [{ id: "weather-1", value: { city: "Paris", units: "celsius" } }]);
    assert.deepEqual(await readSdkToolCall(streamed, z.object({
      city: z.string(),
    }).transform(({ city }) => ({ location: city })), "full"), [
      { id: "weather-1", value: { location: "Paris" } },
    ]);
  });
}

test("completed SDK input survives when no argument deltas were emitted", async () => {
  assert.deepEqual(await readSdkToolCall(false), [{ id: "weather-1", value: { city: "Paris" } }]);
});

test("SDK defaults and transforms survive streamed arguments", async () => {
  for (const streamed of [false, true]) {
    assert.deepEqual(await readSdkToolCall(streamed, z.object({
      city: z.string(),
      units: z.string().default("celsius"),
    })), [{ id: "weather-1", value: { city: "Paris", units: "celsius" } }]);
    assert.deepEqual(await readSdkToolCall(streamed, z.object({
      city: z.string(),
    }).transform(({ city }) => ({ location: city }))), [
      { id: "weather-1", value: { location: "Paris" } },
    ]);
  }
});

for (const format of ["full", "ui"]) {
  for (const snapshots of ["live", "immutable"]) {
    for (const streamed of [false, true]) {
      for (const kind of ["provider-error", "invalid-input"]) {
        test(`${format} ${kind} terminates ${snapshots} input ${streamed ? "after" : "without"} deltas`, async () => {
          const providerError = new Error("provider disconnected");
          const result = sdkToolCall(streamed, undefined, kind === "provider-error"
            ? { failure: providerError }
            : { input: '{"city":42}' });
          const source = format === "full" ? result.fullStream
            : result.toUIMessageStream({ onError: (error) => error.message });
          const diagnostics = [];
          const completed = [];
          let sdkErrorEvent;
          let closed = false;
          const events = (async function* () {
            try {
              for await (const event of source) {
                if (event.type === "error" || event.type === "tool-input-error" || event.invalid === true) sdkErrorEvent = event;
                yield event;
              }
            } finally {
              closed = true;
            }
          })();
          await assert.rejects(async () => {
            for await (const update of readStructured(events, {
              integration: vercelAI, limits: { snapshots },
              onDiagnostic: (value) => diagnostics.push(value),
            })) {
              if (update.type === "complete") completed.push(update);
            }
          }, (error) => {
            assert.ok(sdkErrorEvent);
            assert.equal(error.code, "INTEGRATION_ERROR");
            assert.equal(error.adapter, "vercel-ai");
            assert.equal(error.eventType, sdkErrorEvent.type);
            if (format === "full") assert.equal(error, sdkErrorEvent.error);
            else assert.equal(error.message, sdkErrorEvent.errorText);
            if (kind === "invalid-input") assert.equal(error.id, "weather-1");
            return true;
          });
          assert.deepEqual(completed, []);
          assert.equal(closed, true);
          assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
        });
      }
    }
  }
}
