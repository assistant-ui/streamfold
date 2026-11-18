import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import OpenAI from "openai";
import { readToolInputs } from "./openai-chat-completions.mjs";

const chunk = (tool_calls = [], finish_reason = null) => ({
  id: "chatcmpl_fixture",
  object: "chat.completion.chunk",
  created: 1,
  model: "fixture",
  choices: [{ index: 0, delta: { tool_calls }, finish_reason, logprobs: null }],
});
const first = chunk([
  {
    index: 0,
    id: "call_weather",
    type: "function",
    function: { name: "weather", arguments: '{"city":"Pa' },
  },
  {
    index: 1,
    id: "call_time",
    type: "function",
    function: { name: "time", arguments: '{"zone":' },
  },
]);
const last = (reason = "tool_calls") =>
  chunk(
    [
      { index: 1, function: { arguments: '"UTC"}' } },
      { index: 0, function: { arguments: 'ris"}' } },
    ],
    reason,
  );
const request = {
  model: "fixture",
  stream: true,
  messages: [{ role: "user", content: "Weather?" }],
  tools: [
    {
      type: "function",
      function: { name: "weather", parameters: { type: "object" } },
    },
  ],
};
const encode = (events) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

test("Chat Completions example consumes the real SDK over local HTTP with fragmented SSE", async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const sse =
      encode([
        first,
        last(),
        { ...chunk(), choices: [], usage: { total_tokens: 12 } },
      ]) + "data: [DONE]\n\n";
    for (let offset = 0; offset < sse.length; offset += 7)
      res.write(sse.slice(offset, offset + 7));
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const client = new OpenAI({
      apiKey: "fixture",
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    });
    const source = await client.chat.completions.create(request);
    const updates = [];
    for await (const update of readToolInputs(source)) updates.push(update);
    assert.equal(requests[0].url, "/v1/chat/completions");
    assert.deepEqual(requests[0].body, request);
    assert.deepEqual(
      updates
        .filter(({ type }) => type === "complete")
        .map(({ id, value }) => [id, value]),
      [
        ["call_weather", { city: "Paris" }],
        ["call_time", { zone: "UTC" }],
      ],
    );
    assert.deepEqual(
      updates.find(({ type }) => type === "update").partialValue,
      { city: "Pa" },
    );
    assert.ok(Object.isFrozen(updates.at(-1).value));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

for (const mode of [
  "length",
  "content_filter",
  "truncated",
  "provider-error",
  "malformed",
  "break",
  "abort",
]) {
  test(`Chat Completions SDK ${mode} closes the source without a completed tool`, async () => {
    const controller = new AbortController();
    let cancelled = false;
    const events = [first];
    if (mode === "length" || mode === "content_filter") events.push(last(mode));
    if (mode === "provider-error")
      events.push({
        error: { message: "fixture failure", type: "server_error" },
      });
    if (mode === "malformed")
      events.push(
        chunk([{ index: 0, function: { arguments: '"]' } }], "tool_calls"),
      );
    const body = new ReadableStream({
      start(sink) {
        sink.enqueue(
          new TextEncoder().encode(
            encode(events) + (mode === "truncated" ? "data: [DONE]\n\n" : ""),
          ),
        );
        if (mode === "truncated") sink.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = new OpenAI({
      apiKey: "fixture",
      fetch: async () =>
        new Response(body, {
          headers: { "Content-Type": "text/event-stream" },
        }),
    });
    const source = await client.chat.completions.create(request, {
      signal: controller.signal,
    });
    const completed = [];
    const run = async () => {
      for await (const update of readToolInputs(source, {
        signal: controller.signal,
      })) {
        if (mode === "break") break;
        if (mode === "abort") controller.abort();
        if (update.type === "complete") completed.push(update.value);
      }
    };
    if (mode === "break") await run();
    else
      await assert.rejects(
        run,
        mode === "abort"
          ? { name: "AbortError" }
          : /finish_reason|fixture failure|closing/i,
      );
    assert.deepEqual(completed, []);
    if (mode !== "truncated") assert.equal(cancelled, true);
  });
}
