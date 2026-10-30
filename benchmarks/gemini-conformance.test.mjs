import assert from "node:assert/strict";
import test from "node:test";
import { GoogleGenAI } from "@google/genai";
import { readStructured } from "../packages/core/src/index.js";
import { gemini } from "../packages/core/src/gemini.js";

test("reads function arguments from the Google SDK Interactions SSE stream", async () => {
  const events = [
    { event_type: "step.start", index: 0, step: { type: "thought" } },
    { event_type: "step.stop", index: 0 },
    { event_type: "step.start", index: 1, step: { type: "function_call", id: "weather", name: "get_weather", arguments: {} } },
    { event_type: "step.delta", index: 1, delta: { type: "arguments_delta", arguments: '{"location":"San ' } },
    { event_type: "step.delta", index: 1, delta: { type: "arguments_delta", arguments: 'Francisco, CA"}' } },
    { event_type: "step.stop", index: 1 },
    { event_type: "interaction.completed", interaction: { id: "interaction-1", status: "requires_action", object: "interaction", model: "gemini-3.8-flash" } },
  ];
  const client = new GoogleGenAI({
    apiKey: "test-key",
    httpOptions: {
      fetch: async () => new Response(
        events.map((event) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    },
  });
  const source = await client.interactions.create({
    model: "gemini-3.8-flash", input: "Weather in San Francisco?", stream: true,
  });
  const updates = [];
  for await (const update of readStructured(source, { integration: gemini, limits: { snapshots: "immutable" } })) {
    updates.push(update);
  }
  assert.deepEqual(updates.map(({ type }) => type), ["start", "update", "update", "complete"]);
  assert.deepEqual(updates[1].partialValue, { location: "San " });
  assert.deepEqual(updates.at(-1).value, { location: "San Francisco, CA" });
  assert.equal(updates.at(-1).id, "weather");
});
