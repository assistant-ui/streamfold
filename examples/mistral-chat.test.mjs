import assert from "node:assert/strict";
import test from "node:test";
import { Mistral } from "@mistralai/mistralai";
import { HTTPClient } from "@mistralai/mistralai/lib/http.js";
import { createStructuredStreamPool, readStructured } from "streamfold";
import { mistralChat } from "streamfold/mistral";
import { readToolInputs } from "./mistral-chat.mjs";

const tool = (index, id, args) => ({ index, id, function: { name: "weather", arguments: args } });
const choice = (index, tools, finish_reason = null) => ({
  index,
  delta: { tool_calls: tools },
  finish_reason,
});
const frame = (...choices) =>
  `data: ${JSON.stringify({ id: "chat", model: "fixture", choices })}\n\n`;

function decode(body) {
  const client = new Mistral({
    apiKey: "offline",
    httpClient: new HTTPClient({
      fetcher: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    }),
  });
  return client.chat.stream({
    model: "fixture",
    messages: [{ role: "user", content: "Weather?" }],
  });
}

test("decoded continuations route by choice and tool, including whole final objects", async () => {
  const source = await decode(
    frame(
      choice(0, [tool(0, "a", '{"city":"Pa'), tool(1, "b", { days: 2 })]),
      choice(1, [tool(0, "c", '{"v":')]),
    ) +
      frame(choice(1, [tool(0, "c", "1}")], "stop")) +
      frame(choice(0, [tool(0, undefined, { city: "Paris" })], "tool_calls")) +
      "data: [DONE]\n\n",
  );
  const updates = await Array.fromAsync(readToolInputs(source));
  assert.deepEqual(updates.find((u) => u.type === "update" && u.id === "a").partialValue, {
    city: "Pa",
  });
  assert.deepEqual(
    updates.filter((u) => u.type === "complete").map((u) => [u.id, u.value]),
    [
      ["c", { v: 1 }],
      ["a", { city: "Paris" }],
      ["b", { days: 2 }],
    ],
  );
});

for (const [label, choices, message] of [
  ["missing first ID", [choice(0, [tool(0, undefined, "{}")])], /missing its id/],
  ["empty first ID", [choice(0, [tool(0, "", "{}")])], /missing its id/],
  [
    "placeholder at a new index",
    [choice(0, [tool(0, "a", "{}"), tool(1, undefined, "{}")])],
    /missing its id/,
  ],
  ["changed ID", [choice(0, [tool(0, "a", ""), tool(0, "b", "{}")])], /id changed/],
  ["reused ID", [choice(0, [tool(0, "a", "{}")]), choice(1, [tool(0, "a", "{}")])], /id is reused/],
  [
    "fragment after final object",
    [choice(0, [tool(0, "a", {}), tool(0, "a", "1")])],
    /final object/,
  ],
  ["length", [choice(0, [tool(0, "a", {})]), choice(0, [], "length")], /length/],
  ["error", [choice(0, [tool(0, "a", "{}")]), choice(0, [], "error")], /error/],
  ["open call at EOF", [choice(0, [tool(0, "a", "{}")])], /before finish_reason/],
]) {
  test(`Mistral chat rejects ${label} and discards pending parsers`, async () => {
    const pool = createStructuredStreamPool();
    const stream = mistralChat(pool);
    const source = await decode(choices.map((c) => frame(c)).join(""));
    const updates = [];
    await assert.rejects(
      async () => {
        for await (const event of source) updates.push(...stream.pushAll(event));
        stream.finish();
      },
      (error) => {
        assert.equal(error.adapter, "mistral-chat");
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.match(error.message, message);
        return true;
      },
    );
    assert.deepEqual(pool.activeIds, []);
    assert.ok(!updates.some((u) => u.type === "complete"));
  });
}

test("aborting a stalled chat decoder cancels the body and releases its lock", async () => {
  const stalled = Promise.withResolvers();
  const encoder = new TextEncoder();
  let bodyController;
  let readingRemainder = false;
  let cancellation;
  const body = new ReadableStream(
    {
      start(controller) {
        bodyController = controller;
        controller.enqueue(encoder.encode(frame(choice(0, [tool(0, "a", "{")]))));
      },
      pull() {
        if (readingRemainder) stalled.resolve();
      },
      cancel(reason) {
        cancellation = reason;
      },
    },
    { highWaterMark: 0 },
  );
  const source = await decode(body);
  const controller = new AbortController();
  const updates = readStructured(source, { integration: mistralChat, signal: controller.signal });
  assert.equal((await updates.next()).value.type, "start");
  assert.equal((await updates.next()).value.type, "update");
  const pending = updates.next();
  readingRemainder = true;
  bodyController.enqueue(encoder.encode("data: "));
  await stalled.promise;
  assert.equal(source.locked, true);
  const reason = new Error("reader stopped");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(cancellation, reason);
  assert.equal(source.locked, false);
});

test("the SDK defaults an omitted index to zero and an omitted ID to the literal placeholder", async () => {
  const source = await decode(
    frame(choice(0, [tool(undefined, "a", '{"n":')])) +
      frame(choice(0, [tool(undefined, undefined, "42}")], "tool_calls")),
  );
  const [first, last] = await Array.fromAsync(source);
  const continuation = last.data.choices[0].delta.toolCalls[0];
  assert.equal(continuation.index, 0);
  assert.equal(continuation.id, "null");
  const stream = mistralChat();
  stream.pushAll(first);
  const updates = stream.pushAll(last);
  assert.deepEqual(
    updates.map(({ id, type }) => [id, type]),
    [
      ["a", "update"],
      ["a", "complete"],
    ],
  );
  assert.deepEqual(updates.at(-1).value, { n: 42 });
});
