import assert from "node:assert/strict";
import test from "node:test";
import { CohereClientV2 } from "cohere-ai";
import { readStructured } from "../packages/core/src/index.js";
import { cohere } from "../packages/core/src/cohere.js";

test("reads interleaved arguments from Cohere SDK camelCase SSE events", async () => {
  const events = [
    { type: "message-start", id: "fixture", delta: { message: { role: "assistant" } } },
    { type: "tool-plan-delta", delta: { message: { tool_plan: "Check both cities" } } },
    ...["paris", "tokyo"].map((id, index) => ({ type: "tool-call-start", index, delta: { message: { tool_calls: { id, type: "function", function: { name: "weather", arguments: "" } } } } })),
    { type: "tool-call-delta", index: 0, delta: { message: { tool_calls: { function: { arguments: '{"city":"Pa' } } } } },
    { type: "tool-call-delta", index: 1, delta: { message: { tool_calls: { function: { arguments: '{"city":"Tokyo"}' } } } } },
    { type: "tool-call-delta", index: 0, delta: { message: { tool_calls: { function: { arguments: 'ris"}' } } } } },
    { type: "tool-call-end", index: 1 }, { type: "tool-call-end", index: 0 },
    { type: "message-end", delta: { finish_reason: "TOOL_CALL" } },
  ];
  const client = new CohereClientV2({
    token: "test-token",
    fetch: async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } }),
  });
  const source = await client.chatStream({ model: "command-a", messages: [{ role: "user", content: "Weather?" }] });
  const updates = [];
  for await (const update of readStructured(source, { integration: cohere, limits: { snapshots: "immutable" } })) updates.push(update);
  assert.deepEqual(updates.map(({ type, id }) => [type, id]), [["start", "paris"], ["start", "tokyo"], ["update", "paris"], ["update", "tokyo"], ["update", "paris"], ["complete", "tokyo"], ["complete", "paris"]]);
  assert.deepEqual(updates[2].partialValue, { city: "Pa" });
  assert.deepEqual(updates.slice(-2).map(({ value }) => value), [{ city: "Tokyo" }, { city: "Paris" }]);
});

for (const finishReason of ["ERROR", "TIMEOUT"]) {
  test(`Cohere SDK ${finishReason} endings reject pending arguments without error text`, async () => {
    const events = [
      { type: "message-start", id: "fixture", delta: { message: { role: "assistant" } } },
      { type: "tool-call-start", index: 0, delta: { message: { tool_calls: { id: "weather", type: "function", function: { name: "weather", arguments: "" } } } } },
      { type: "tool-call-delta", index: 0, delta: { message: { tool_calls: { function: { arguments: '{"city":"Paris"}' } } } } },
      { type: "message-end", delta: { finish_reason: finishReason } },
    ];
    const client = new CohereClientV2({
      token: "test-token",
      fetch: async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    const source = await client.chatStream({ model: "command-a", messages: [{ role: "user", content: "Weather?" }] });
    let ending;
    let closed = false;
    const decoded = (async function* () {
      try {
        for await (const event of source) {
          if (event.type === "message-end") ending = event.delta;
          yield event;
        }
      } finally { closed = true; }
    })();
    const completed = [];
    await assert.rejects(async () => {
      for await (const update of readStructured(decoded, { integration: cohere })) {
        if (update.type === "complete") completed.push(update.value);
      }
    }, (error) => {
      assert.equal(error.message, `Cohere generation failed: ${finishReason}`);
      assert.equal(error.code, "INTEGRATION_ERROR");
      assert.equal(error.cause, ending);
      return true;
    });
    assert.equal(ending.finishReason, finishReason);
    assert.deepEqual(completed, []);
    assert.equal(closed, true);
  });
}
