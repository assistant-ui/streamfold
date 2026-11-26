import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";
import { openAIRealtime } from "streamfold/openai";

test("OpenAI's native WebSocket decoder delivers Realtime function arguments", (t) => {
  // Replace only the wire. The SDK registers its own decoder and emits server events.
  t.mock.method(globalThis, "WebSocket", class extends EventTarget {});
  const socket = new OpenAIRealtimeWebSocket(
    { model: "fixture" },
    {
      apiKey: "offline",
      baseURL: "https://realtime.invalid/v1",
    },
  );
  const stream = openAIRealtime();
  const updates = [];
  socket.on("event", (event) => updates.push(...stream.pushAll(event)));
  const frame = (event) =>
    socket.socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ event_id: "event-" + event.type, ...event }),
      }),
    );
  const call = { type: "function_call", id: "item", call_id: "call", name: "weather" };
  const ids = { response_id: "resp", output_index: 0, item_id: "item", call_id: "call" };
  frame({
    type: "response.output_item.added",
    ...ids,
    item: { ...call, arguments: "", status: "in_progress" },
  });
  frame({ type: "response.function_call_arguments.delta", ...ids, delta: '{"city":"Par' });
  assert.deepEqual(updates.at(-1).partialValue, { city: "Par" });
  const args = '{"city":"Paris"}';
  frame({
    type: "response.function_call_arguments.done",
    ...ids,
    name: "weather",
    arguments: args,
  });
  const item = { ...call, arguments: args, status: "completed" };
  frame({ type: "response.output_item.done", ...ids, item });
  assert.deepEqual(
    updates.map((u) => u.type),
    ["start", "update"],
  );
  frame({ type: "response.done", response: { id: "resp", status: "completed", output: [item] } });
  assert.equal(updates.at(-1).type, "complete");
  assert.deepEqual(
    stream.finish().map((u) => [u.id, u.value]),
    [["call", { city: "Paris" }]],
  );
});
