import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { readStructured } from "../packages/core/src/index.js";
import { anthropic } from "../packages/core/src/anthropic.js";

for (const api of ["standard", "beta"]) {
  test(`Anthropic ${api} SDK accepts empty inputs without masking truncated arguments`, async () => {
    for (const [deltas, expected] of [
      [[], {}],
      [[""], {}],
      [["{}"], {}],
      [["", '{"city":', '"Paris"}'], { city: "Paris" }],
      [['{"city":'], undefined],
    ]) {
      const events = [
        { type: "message_start", message: { id: "message", type: "message", role: "assistant", content: [], model: "test-model", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "weather", name: "weather", input: {} } },
        ...deltas.map((partial_json) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json } })),
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: "message_stop" },
      ];
      const client = new Anthropic({
        apiKey: "test-key",
        fetch: async () => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
          headers: { "Content-Type": "text/event-stream" },
        }),
      });
      const messages = api === "standard" ? client.messages : client.beta.messages;
      const request = { model: "test-model", max_tokens: 32, messages: [{ role: "user", content: "Weather?" }] };
      if (expected !== undefined) {
        const native = await messages.stream(request).finalMessage();
        assert.deepEqual(native.content[0].input, expected);
      }
      const source = await messages.create({ ...request, stream: true });
      const completed = [];
      const read = async () => {
        for await (const update of readStructured(source, { integration: anthropic })) {
          if (update.type === "complete") completed.push({ id: update.id, value: update.value });
        }
      };
      if (expected === undefined) {
        await assert.rejects(read, { code: "INCOMPLETE_JSON", adapter: "anthropic" });
        assert.deepEqual(completed, []);
      } else {
        await read();
        assert.deepEqual(completed, [{ id: "weather", value: expected }]);
      }
    }
  });
}
