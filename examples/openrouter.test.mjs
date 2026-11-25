import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouter } from "@openrouter/sdk";
import { HTTPClient } from "@openrouter/sdk/lib/http";
import { readStructured } from "streamfold";
import { openRouter } from "streamfold/openrouter";
import { readToolInputs } from "./openrouter.mjs";

const choice = (index, tool_calls, finish_reason = null) => ({
  index,
  delta: { tool_calls },
  finish_reason,
});
const tool = (index, args, id) => ({
  index,
  id,
  type: id ? "function" : undefined,
  function: { name: id ? "weather" : undefined, arguments: args },
});

async function decode(frames, { onCancel, onPull } = {}) {
  const sse = frames
    .map(
      (frame) =>
        "data: " +
        JSON.stringify({
          id: "chat-fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          ...frame,
        }) +
        "\n\n",
    )
    .join("");
  const body = new ReadableStream(
    {
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        if (!onCancel) controller.close();
      },
      pull: onPull,
      cancel: onCancel,
    },
    { highWaterMark: 0 },
  );
  const client = new OpenRouter({
    apiKey: "fixture",
    httpClient: new HTTPClient({
      fetcher: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    }),
  });
  return client.chat.send({
    chatRequest: {
      model: "fixture",
      messages: [{ role: "user", content: "Weather?" }],
      stream: true,
    },
  });
}

test("native OpenRouter chunks retain every interleaved call and choice", async () => {
  const source = await decode([
    {
      choices: [
        choice(0, [tool(0, '{"city":"Pa', "a"), tool(1, "[", "b")]),
        choice(1, [tool(0, "42", "c")]),
      ],
    },
    { choices: [choice(1, [], "stop")] },
    { choices: [choice(0, [tool(1, "1]"), tool(0, 'ris"}')], "tool_calls")] },
    { choices: [] },
  ]);
  const updates = await Array.fromAsync(readToolInputs(source));
  assert.deepEqual(
    updates.map(({ type, id }) => [type, id]),
    [
      ["start", "a"],
      ["update", "a"],
      ["start", "b"],
      ["update", "b"],
      ["start", "c"],
      ["update", "c"],
      ["complete", "c"],
      ["update", "b"],
      ["update", "a"],
      ["complete", "a"],
      ["complete", "b"],
    ],
  );
  assert.deepEqual(updates[1].partialValue, { city: "Pa" });
  assert.deepEqual(
    updates.filter((u) => u.type === "complete").map((u) => u.value),
    [42, { city: "Paris" }, [1]],
  );
});

const started = { choices: [choice(0, [tool(0, "{}", "a")])] };
const providerError = { code: 503, message: "Provider unavailable" };

for (const [name, frame] of [
  ["provider error", { choices: [choice(0, [], "stop")], error: providerError }],
  ["length", { choices: [choice(0, [], "length")] }],
]) {
  test(`OpenRouter rejects ${name} with valid JSON pending and cancels the body`, async () => {
    let cancelled = false;
    const source = await decode([started, frame], {
      onCancel() {
        cancelled = true;
      },
    });
    const updates = [];
    await assert.rejects(
      async () => {
        for await (const update of readToolInputs(source)) updates.push(update.type);
      },
      (error) => {
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.adapter, "openrouter");
        if (name === "length") assert.equal(error.cause.finishReason, "length");
        else {
          assert.equal(error.message, providerError.message);
          assert.deepEqual(error.cause, providerError);
        }
        return true;
      },
    );
    assert.deepEqual(updates, ["start", "update"]);
    assert.equal(cancelled, true);
    assert.equal(source.locked, false);
  });
}

test("aborting a pending OpenRouter read cancels the body with the caller's reason", async () => {
  const stalled = Promise.withResolvers();
  let cancellation;
  const source = await decode([started], {
    onCancel(reason) {
      cancellation = reason;
    },
    onPull() {
      stalled.resolve();
    },
  });
  const controller = new AbortController();
  const updates = readToolInputs(source, { signal: controller.signal });
  assert.equal((await updates.next()).value.type, "start");
  assert.equal((await updates.next()).value.type, "update");
  const pending = updates.next();
  await stalled.promise;
  const reason = new Error("stopped");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(cancellation, reason);
  assert.equal(source.locked, false);
});

test("returning early releases pending parsers and the SDK stream", async () => {
  let cancelled = false;
  let pool;
  const source = await decode([started], {
    onCancel() {
      cancelled = true;
    },
  });
  const updates = readStructured(source, {
    integration(ownedPool, options) {
      pool = ownedPool;
      return openRouter(pool, options);
    },
  });
  assert.equal((await updates.next()).value.type, "start");
  assert.equal(pool.size, 1);
  await updates.return();
  assert.equal(pool.size, 0);
  assert.equal(cancelled, true);
  assert.equal(source.locked, false);
});
