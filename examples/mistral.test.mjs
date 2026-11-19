import assert from "node:assert/strict";
import test from "node:test";
import { Mistral } from "@mistralai/mistralai";
import { HTTPClient } from "@mistralai/mistralai/lib/http.js";
import { readToolInputs } from "./mistral.mjs";

const events = [
  { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "a", call_id: "call-a", name: "weather", arguments: "" } },
  { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "b", call_id: "call-b", name: "weather", arguments: "" } },
  { type: "response.function_call_arguments.delta", output_index: 0, item_id: "a", delta: '{"city":"San' },
  { type: "response.function_call_arguments.delta", output_index: 1, item_id: "b", delta: '{"city":"Paris"}' },
  { type: "response.function_call_arguments.delta", output_index: 0, item_id: "a", delta: ' Francisco"}' },
  { type: "response.function_call_arguments.done", output_index: 1, item_id: "b", name: "weather", arguments: '{"city":"Paris"}' },
  { type: "response.function_call_arguments.done", output_index: 0, item_id: "a", name: "weather", arguments: '{"city":"San Francisco"}' },
];

const sse = events.map((event, sequence_number) =>
  `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`
).join("");

function createStream(body) {
  const client = new Mistral({
    apiKey: "test-key",
    httpClient: new HTTPClient({
      fetcher: async () => new Response(body, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    }),
  });
  return client.responses.create({ model: "test-model", input: "Weather?", stream: true });
}

test("Mistral SDK frames preserve interleaved tool IDs and partial snapshots", async () => {
  const source = await createStream(sse);
  const updates = [];
  for await (const update of readToolInputs(source)) updates.push(update);

  assert.deepEqual(updates.map(({ type, id }) => [type, id]), [
    ["start", "a"], ["start", "b"], ["update", "a"], ["update", "b"],
    ["update", "a"], ["complete", "b"], ["complete", "a"],
  ]);
  assert.deepEqual(updates[2].partialValue, { city: "San" });
  assert.ok(Object.isFrozen(updates[2].partialValue));
  assert.deepEqual(updates.slice(-2).map(({ value }) => value), [
    { city: "Paris" }, { city: "San Francisco" },
  ]);
});

test("stopping the Mistral example cancels the SDK response body", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(sse)); },
    cancel() { cancelled = true; },
  });
  const source = await createStream(body);
  const iterator = readToolInputs(source);
  try {
    assert.equal((await iterator.next()).value.type, "start");
    assert.equal((await iterator.next()).value.type, "start");
    assert.equal((await iterator.next()).value.type, "update");
  } finally {
    await iterator.return();
  }
  assert.equal(cancelled, true);
});

const terminalResponse = {
  id: "response-test",
  created_at: 1,
  model: "test-model",
  object: "response",
  output: [],
  parallel_tool_calls: true,
  tool_choice: "auto",
  tools: [],
};
const providerError = { code: "server_error", message: "Provider unavailable" };
const failures = [
  {
    name: "failed responses",
    event: {
      type: "response.failed",
      response: { ...terminalResponse, status: "failed", error: providerError },
    },
    message: /Provider unavailable/,
    cause: providerError,
  },
  {
    name: "error events",
    event: { type: "error", ...providerError, param: null },
    message: /Provider unavailable/,
  },
  ...["max_output_tokens", "content_filter", null].map((reason) => ({
    name: `incomplete responses (${reason})`,
    event: {
      type: "response.incomplete",
      response: { ...terminalResponse, status: "incomplete", incomplete_details: { reason } },
    },
    message: reason ? new RegExp(`response incomplete: ${reason}`) : /response incomplete$/,
    cause: { reason },
  })),
];

for (const failure of failures) {
  test(`Mistral ${failure.name} preserve failure details and cancel pending inputs`, async () => {
    let cancelled = false;
    const pending = [
      events[0],
      events[1],
      { ...events[2], delta: '{"city":"Paris"}' },
      failure.event,
    ];
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            pending
              .map(
                (event, sequence_number) =>
                  `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
              )
              .join(""),
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const source = await createStream(body);
    const updates = [];
    await assert.rejects(
      async () => {
        for await (const update of readToolInputs(source)) updates.push(update);
      },
      (error) => {
        assert.match(error.message, failure.message);
        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.equal(error.eventType, failure.event.type);
        if (failure.cause) assert.deepEqual(error.cause, failure.cause);
        else {
          assert.equal(error.cause.message, providerError.message);
          assert.equal(error.cause.code, providerError.code);
        }
        return true;
      },
    );
    assert.equal(cancelled, true);
    assert.deepEqual(
      updates.map(({ type }) => type),
      ["start", "start", "update"],
    );
    assert.deepEqual(updates.at(-1).partialValue, { city: "Paris" });
  });
}
