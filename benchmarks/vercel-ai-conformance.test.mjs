import assert from "node:assert/strict";
import test from "node:test";
import { streamText, tool } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { readStructured } from "../packages/core/src/index.js";
import { vercelAI } from "../packages/core/src/vercel-ai.js";

const sdkToolCall = (streamed, inputSchema = z.object({ city: z.string() }), {
  input = '{"city":"Paris"}', failure, finishReason = failure ? "error" : "tool-calls",
} = {}) => {
  const chunks = [
    { type: "stream-start", warnings: [] },
    ...(streamed ? [
      { type: "tool-input-start", id: "weather-1", toolName: "weather" },
      { type: "tool-input-delta", id: "weather-1", delta: input },
      ...(finishReason === "error" ? [] : [{ type: "tool-input-end", id: "weather-1" }]),
    ] : []),
    ...(failure ? [{ type: "error", error: failure }]
      : finishReason === "error" ? []
        : [{ type: "tool-call", toolCallId: "weather-1", toolName: "weather", input }]),
    {
      type: "finish",
      finishReason: { unified: finishReason, raw: finishReason === "error" ? "error" : "tool_calls" },
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
  for (const [kind, input] of [["no", undefined], ["complete", '{"city":"Paris"}'], ["incomplete", '{"city":']]) {
    test(`${format} SDK error finish reasons reject ${kind} pending arguments`, async () => {
      const result = sdkToolCall(input !== undefined, undefined, { input, finishReason: "error" });
      const source = format === "full" ? result.fullStream : result.toUIMessageStream();
      const completed = [];
      let ending;
      let closed = false;
      let readPastFailure = false;
      const events = (async function* () {
        try {
          for await (const event of source) {
            if (event.finishReason === "error") ending = event;
            yield event;
            if (event.finishReason === "error") readPastFailure = true;
          }
        } finally {
          closed = true;
        }
      })();
      await assert.rejects(async () => {
        for await (const update of readStructured(events, { integration: vercelAI })) {
          if (update.type === "complete") completed.push(update);
        }
      }, (error) => {
        assert.equal(ending?.type, format === "full" ? "finish-step" : "finish");
        assert.equal(error.message, "Vercel AI generation failed");
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.eventType, ending.type);
        assert.equal(error.cause, ending);
        return true;
      });
      assert.deepEqual(completed, []);
      assert.equal(closed, true);
      assert.equal(readPastFailure, false);
    });
  }

  test(`${format} SDK abort events reject pending arguments without a shared reader signal`, { timeout: 3000 }, async () => {
    const controller = new AbortController();
    const result = streamText({
      abortSignal: controller.signal,
      model: new MockLanguageModelV4({ doStream: {
        stream: new ReadableStream({
          start(stream) {
            stream.enqueue({ type: "stream-start", warnings: [] });
            stream.enqueue({ type: "tool-input-start", id: "weather", toolName: "weather" });
            stream.enqueue({ type: "tool-input-delta", id: "weather", delta: '{"city":"Paris"}' });
          },
        }),
      } }),
      prompt: "Weather in Paris?",
      tools: { weather: tool({ inputSchema: z.object({ city: z.string() }) }) },
      onError() {},
    });
    const source = format === "full" ? result.fullStream : result.toUIMessageStream();
    let abortEvent;
    let closed = false;
    const events = (async function* () {
      try {
        for await (const event of source) {
          if (event.type === "abort") abortEvent = event;
          yield event;
          if (event.type === "tool-input-delta") controller.abort(new Error("cancelled by user"));
        }
      } finally {
        closed = true;
      }
    })();
    const completed = [];
    await assert.rejects(async () => {
      for await (const update of readStructured(events, { integration: vercelAI })) {
        if (update.type === "complete") completed.push(update);
      }
    }, (error) => {
      assert.equal(abortEvent?.type, "abort");
      assert.equal(error.message, "Error: cancelled by user");
      assert.equal(error.cause, abortEvent);
      assert.equal(error.code, "INTEGRATION_ERROR");
      return true;
    });
    assert.deepEqual(completed, []);
    assert.equal(closed, true);
  });

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
