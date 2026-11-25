import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { stream as anthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { stream as gemini } from "@earendil-works/pi-ai/api/google-generative-ai";
import { stream as openai } from "@earendil-works/pi-ai/api/openai-completions";
import { readToolInputs } from "../examples/pi.mjs";

const id = "call_weather";
const model = {
  id: "fixture",
  name: "fixture",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 256,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const context = normalizeContext({
  messages: [{ role: "user", content: "Weather?", timestamp: 1 }],
});
const response = (wire) => new Response(wire, { headers: { "content-type": "text/event-stream" } });

function openAIResponse(fragments, finish_reason = "tool_calls") {
  const choices = fragments.map((args, i) => ({
    index: 0,
    finish_reason: null,
    delta: {
      tool_calls: [
        {
          index: 0,
          ...(i === 0 && { id, type: "function" }),
          function: { ...(i === 0 && { name: "weather" }), arguments: args },
        },
      ],
    },
  }));
  choices.push({ index: 0, delta: {}, finish_reason });
  return response(
    choices
      .map((choice) => {
        const chunk = {
          id: "msg",
          model: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          choices: [choice],
        };
        return `data: ${JSON.stringify(chunk)}\n\n`;
      })
      .join("") + "data: [DONE]\n\n",
  );
}

function anthropicResponse(fragments) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg",
        role: "assistant",
        type: "message",
        model: "fixture",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id, name: "weather", input: {} },
    },
    ...fragments.map((partial_json) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json },
    })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 3 },
    },
    { type: "message_stop" },
  ];
  return response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
  );
}

for (const [api, provider, stream, fixture] of [
  ["openai-completions", "openai", openai, openAIResponse],
  ["anthropic-messages", "anthropic", anthropic, anthropicResponse],
]) {
  const read = (fragments) =>
    readToolInputs((signal) =>
      stream({ ...model, api, provider }, context, {
        apiKey: "fixture",
        signal,
        fetch: async () => fixture(fragments),
      }),
    );
  test(`Pi ${api} decodes split SSE tool arguments`, async () => {
    const updates = [];
    for await (const update of read(['{"city":"Pa', 'ris"}'])) updates.push(update);
    assert.deepEqual(
      updates.filter((u) => u.type === "complete").map((u) => [u.id, u.value]),
      [[id, { city: "Paris" }]],
    );
    assert.ok(
      updates.some((u) => u.type === "update" && u.id === id && u.partialValue.city === "Pa"),
    );
  });
  test(`Pi ${api} rejects malformed final arguments`, async () => {
    await assert.rejects(
      async () => {
        for await (const update of read(['{"city":'])) assert.notEqual(update.type, "complete");
      },
      { code: "INTEGRATION_ERROR", id },
    );
  });
}

test("Pi Anthropic closes a no-argument tool without any delta", async () => {
  const updates = [];
  for await (const update of readToolInputs((signal) =>
    anthropic({ ...model, api: "anthropic-messages", provider: "anthropic" }, context, {
      apiKey: "fixture",
      signal,
      fetch: async () => anthropicResponse([]),
    }),
  ))
    updates.push(update);
  assert.deepEqual(
    updates.map((u) => u.type),
    ["start", "complete"],
  );
  assert.deepEqual(updates[1].value, {});
});

test("Pi OpenAI length ending fails the message even after a complete call", async () => {
  await assert.rejects(
    async () => {
      for await (const _ of readToolInputs((signal) =>
        openai({ ...model, api: "openai-completions", provider: "openai" }, context, {
          apiKey: "fixture",
          signal,
          fetch: async () => openAIResponse(["{}"], "length"),
        }),
      )) {
        /* Drain the message through its terminal event. */
      }
    },
    { code: "INTEGRATION_ERROR", message: /length/ },
  );
});

const geminiModel = { ...model, api: "google-generative-ai", provider: "google" };

function readGemini(calls, finishReason) {
  const candidates = [
    { content: { role: "model", parts: calls.map((functionCall) => ({ functionCall })) } },
  ];
  if (finishReason) candidates.push({ finishReason });
  const wire = candidates
    .map((candidate) => `data: ${JSON.stringify({ candidates: [candidate] })}\n\n`)
    .join("");
  return readToolInputs((signal) =>
    gemini(geminiModel, context, { apiKey: "fixture", signal, fetch: async () => response(wire) }),
  );
}

test("Pi Gemini decodes object arguments and preserves each call's ID across updates", async () => {
  const args = { cities: ["Paris", "Lyon"], options: { metric: true } };
  const updates = await Array.fromAsync(
    readGemini(
      [
        { id, name: "weather", args },
        { name: "weather", args: {} },
      ],
      "STOP",
    ),
  );
  const generatedId = updates[3]?.id;
  assert.equal(typeof generatedId, "string");
  assert.ok(generatedId.length > 0);
  assert.notEqual(generatedId, id);
  assert.deepEqual(
    updates.map((u) => [u.type, u.id]),
    [
      ["start", id],
      ["update", id],
      ["complete", id],
      ["start", generatedId],
      ["update", generatedId],
      ["complete", generatedId],
    ],
  );
  assert.deepEqual(updates[1].partialValue, args);
  assert.deepEqual(updates[2].value, args);
  assert.deepEqual(updates[5].value, {});
});

for (const [ending, message] of [
  ["MAX_TOKENS", /length/],
  ["SAFETY", /SAFETY/],
  [undefined, /without a finish reason/],
]) {
  test(`Pi Gemini rejects ${ending ?? "EOF without a finish reason"} after a complete call`, async () => {
    const completed = [];
    await assert.rejects(
      async () => {
        for await (const update of readGemini([{ id, name: "weather", args: {} }], ending)) {
          if (update.type === "complete") completed.push([update.id, update.value]);
        }
      },
      { code: "INTEGRATION_ERROR", message },
    );
    assert.deepEqual(completed, [[id, {}]]);
  });
}

for (const [providerModel, stream] of [
  [{ ...model, api: "openai-completions", provider: "openai" }, openai],
  [geminiModel, gemini],
]) {
  test(`cancelling a pending Pi ${providerModel.api} read aborts the SDK fetch with the caller's reason`, async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers();
    const reader = readToolInputs(
      (signal) =>
        stream(providerModel, context, {
          apiKey: "fixture",
          signal,
          fetch: (_url, init) =>
            new Promise((_, reject) => {
              started.resolve(init.signal);
              init.signal.addEventListener("abort", () => reject(init.signal.reason), {
                once: true,
              });
            }),
        }),
      { signal: controller.signal },
    );
    const first = reader.next();
    const transportSignal = await started.promise;
    controller.abort(new Error("cancelled by caller"));
    await assert.rejects(first, (err) => err === controller.signal.reason);
    assert.equal(transportSignal.aborted, true);
  });
}
