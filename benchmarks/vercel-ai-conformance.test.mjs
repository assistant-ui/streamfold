import assert from "node:assert/strict";
import test from "node:test";
import { streamText, tool } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { readStructured } from "../packages/core/src/index.js";
import { vercelAI } from "../packages/core/src/vercel-ai.js";

async function readSdkToolCall(streamed, inputSchema = z.object({ city: z.string() })) {
  const input = '{"city":"Paris"}';
  const chunks = [
    { type: "stream-start", warnings: [] },
    ...(streamed ? [
      { type: "tool-input-start", id: "weather-1", toolName: "weather" },
      { type: "tool-input-delta", id: "weather-1", delta: input },
      { type: "tool-input-end", id: "weather-1" },
    ] : []),
    { type: "tool-call", toolCallId: "weather-1", toolName: "weather", input },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
  const result = streamText({
    model: new MockLanguageModelV4({ doStream: {
      stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
    } }),
    prompt: "Weather in Paris?",
    tools: { weather: tool({ description: "Get weather", inputSchema }) },
  });
  const updates = [];
  for await (const update of readStructured(result.toUIMessageStream(), { integration: vercelAI })) {
    if (update.type === "complete") updates.push({ id: update.id, value: update.value });
  }
  return updates;
}

test("streamed SDK arguments produce a completed tool input", async () => {
  assert.deepEqual(await readSdkToolCall(true), [{ id: "weather-1", value: { city: "Paris" } }]);
});

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
