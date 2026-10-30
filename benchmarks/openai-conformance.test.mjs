import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { readStructured } from "../packages/core/src/index.js";
import { openAI } from "../packages/core/src/openai.js";

const input = '{"city":"Paris"}';
const item = {
  id: "fc_weather", call_id: "call_weather", type: "function_call",
  name: "weather", arguments: "", status: "in_progress",
};
const response = (status, withCall) => ({
  id: "resp_fixture", object: "response", created_at: 1, model: "test-model", status,
  access_programs: null, output_text: "", instructions: null, metadata: {},
  error: status === "failed" ? { code: "server_error", message: "provider disconnected" } : null,
  incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
  output: withCall ? [{ ...item, arguments: input, status: status === "completed" ? "completed" : "incomplete" }] : [],
  parallel_tool_calls: true, temperature: 1, tool_choice: "auto", tools: [], top_p: 1,
});

const sdkStream = async (status, withCall) => {
  const events = [
    { type: "response.created", response: response("in_progress", false) },
    ...(withCall ? [
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: input },
    ] : []),
    ...(status === "completed" && withCall ? [
      { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: input },
      { type: "response.output_item.done", output_index: 0, item: { ...item, arguments: input, status: "completed" } },
    ] : []),
    status === "sse-error"
      ? { type: "error", code: "server_error", message: "provider disconnected", param: null }
      : { type: `response.${status}`, response: response(status, withCall) },
  ];
  const sse = events.map((event, sequence_number) =>
    `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`
  ).join("");
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse));
      if (status === "completed") controller.close();
    },
    cancel() { cancelled = true; },
  });
  const client = new OpenAI({
    apiKey: "test-key",
    fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
  });
  const source = await client.responses.create({ model: "test-model", input: "fixture", stream: true });
  return { source, isCancelled: () => cancelled };
};

for (const snapshots of ["live", "immutable"]) {
  for (const withCall of [false, true]) {
    for (const status of ["failed", "incomplete", "sse-error", "completed"]) {
      test(`OpenAI SDK ${status} ${withCall ? "with" : "without"} pending ${snapshots} input`, { timeout: 2000 }, async () => {
        const { source, isCancelled } = await sdkStream(status, withCall);
        const sdkEvents = [];
        let sdkError;
        let closed = false;
        const events = (async function* () {
          try {
            for await (const event of source) {
              sdkEvents.push(event);
              yield event;
            }
          } catch (error) {
            sdkError = error;
            throw error;
          } finally {
            closed = true;
          }
        })();
        const diagnostics = [];
        const completed = [];
        const read = async () => {
          for await (const update of readStructured(events, {
            integration: openAI, limits: { snapshots },
            onDiagnostic: (value) => diagnostics.push(value),
          })) {
            if (update.type === "complete") completed.push({ id: update.id, value: update.value });
          }
        };
        if (status === "completed") {
          await read();
          assert.deepEqual(completed, withCall ? [{ id: item.id, value: { city: "Paris" } }] : []);
          assert.ok(!diagnostics.some(({ code }) => code === "STREAM_ERROR"));
        } else {
          await assert.rejects(read, (error) => {
            if (status === "sse-error") {
              assert.equal(error, sdkError);
              assert.equal(error.code, "server_error");
              assert.equal(error.message, "provider disconnected");
            } else {
              const event = sdkEvents.at(-1);
              assert.equal(event.type, `response.${status}`);
              assert.equal(error.code, "INTEGRATION_ERROR");
              assert.equal(error.eventType, event.type);
              assert.equal(error.adapter, "openai");
              assert.equal(error.cause, status === "failed" ? event.response.error : event.response.incomplete_details);
              assert.match(error.message, status === "failed" ? /provider disconnected/ : /max_output_tokens/);
            }
            return true;
          });
          assert.deepEqual(completed, []);
          assert.equal(isCancelled(), true);
          assert.deepEqual(diagnostics.map(({ code }) => code), status === "sse-error" ? [] : ["STREAM_ERROR"]);
        }
        assert.equal(closed, true);
      });
    }
  }
}
