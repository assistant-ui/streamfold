import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { readStructured } from "../packages/core/src/index.js";
import { anthropic } from "../packages/core/src/anthropic.js";

for (const api of ["standard", "beta"]) {
  test(`Anthropic ${api} SDK retains initial inputs without masking truncated arguments`, async () => {
    for (const [deltas, expected, initial = {}, type = "tool_use"] of [
      [[], {}],
      ...(api === "beta" ? [
        [[], { city: "Paris" }, { city: "Paris" }, "mcp_tool_use"],
        [[""], {}, {}, "mcp_tool_use"],
        [['{"city":"Ro', 'me"}'], { city: "Rome" }, {}, "mcp_tool_use"],
        [['{"city":'], undefined, {}, "mcp_tool_use"],
      ] : []),
      [[], { city: "Paris" }, { city: "Paris" }],
      [[], { query: "weather" }, { query: "weather" }, "server_tool_use"],
      [['{"city":'], undefined, { city: "Paris" }],
      [['{"city":"Rome"}'], { city: "Rome" }, { city: "Paris" }],
      [[""], {}],
      [["{}"], {}],
      [["", '{"city":', '"Paris"}'], { city: "Paris" }],
      [['{"city":'], undefined],
    ]) {
      const events = [
        { type: "message_start", message: { id: "message", type: "message", role: "assistant", content: [], model: "test-model", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type, id: "weather", name: "weather", input: initial, ...(type === "mcp_tool_use" ? { server_name: "weather-tools" } : {}) } },
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

for (const api of ["standard", "beta"]) {
  test(`Anthropic ${api} SDK rejects a stream that ends after a tool block starts`, async () => {
    for (const [deltas, initial] of [[[], {}], [[""], {}], [[], { city: "Paris" }]]) {
      const events = [
        { type: "message_start", message: { id: "message", type: "message", role: "assistant", content: [], model: "test-model", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "weather", input: initial } },
        ...deltas.map((partial_json) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json } })),
      ];
      const client = new Anthropic({
        apiKey: "test-key",
        fetch: async () => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
          headers: { "Content-Type": "text/event-stream" },
        }),
      });
      const messages = api === "standard" ? client.messages : client.beta.messages;
      const source = await messages.create({ model: "test-model", max_tokens: 32, messages: [{ role: "user", content: "Weather?" }], stream: true });
      const completed = [];
      await assert.rejects(async () => {
        for await (const update of readStructured(source, { integration: anthropic })) {
          if (update.type === "complete") completed.push(update);
        }
      }, { code: "INTEGRATION_ERROR", id: "toolu_1", adapter: "anthropic" });
      assert.deepEqual(completed, []);
    }
  });
}
