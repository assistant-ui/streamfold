import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defineAdapter, readStructured } from "./index.js";
import { agUI } from "./ag-ui.js";
import { anthropic } from "./anthropic.js";
import { assistantUI } from "./assistant-ui.js";
import { bedrock } from "./bedrock.js";
import { cohere } from "./cohere.js";
import { gemini } from "./gemini.js";
import { mistralChat } from "./mistral.js";
import { langchain } from "./langchain.js";
import { openAI, openAIChatCompletions } from "./openai.js";
import { vercelAI } from "./vercel-ai.js";

const apiDoc = await readFile(new URL("../../../API.md", import.meta.url), "utf8");
const id = "call";

// Each row label in API.md's end-of-stream table maps to the events that open,
// feed, and close one call for that adapter.
const adapters = {
  "Anthropic, including beta": {
    integration: anthropic,
    start: [
      { type: "message_start", message: {} },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "weather", input: {} } },
    ],
    delta: (text) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: text } }),
    close: () => [{ type: "content_block_stop", index: 0 }],
    end: [{ type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" }],
  },
  "Gemini, `step.start` with `arguments: {}`": {
    integration: gemini,
    start: [{ event_type: "step.start", index: 0, step: { type: "function_call", id, name: "weather", arguments: {} } }],
    delta: (text) => ({ event_type: "step.delta", index: 0, delta: { type: "arguments_delta", arguments: text } }),
    close: () => [{ event_type: "step.stop", index: 0 }],
  },
  "Gemini, `step.start` without `arguments`": {
    integration: gemini,
    start: [{ event_type: "step.start", index: 0, step: { type: "function_call", id, name: "weather" } }],
    delta: (text) => ({ event_type: "step.delta", index: 0, delta: { type: "arguments_delta", arguments: text } }),
    close: () => [
      { event_type: "step.stop", index: 0 },
      { event_type: "interaction.completed", interaction: { status: "requires_action" } },
    ],
  },
  Cohere: {
    integration: cohere,
    start: [{ type: "tool-call-start", index: 0, delta: { message: { toolCalls: { id, type: "function", function: { name: "weather", arguments: "" } } } } }],
    delta: (text) => ({ type: "tool-call-delta", index: 0, delta: { message: { toolCalls: { function: { arguments: text } } } } }),
    close: () => [{ type: "tool-call-end", index: 0 }],
  },
  Bedrock: {
    integration: bedrock,
    start: [{ contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: id, name: "weather" } } } }],
    delta: (text) => ({ contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: text } } } }),
    close: () => [{ contentBlockStop: { contentBlockIndex: 0 } }],
  },
  "AG-UI": {
    integration: agUI,
    start: [{ type: "TOOL_CALL_START", toolCallId: id, toolCallName: "weather" }],
    delta: (text) => ({ type: "TOOL_CALL_ARGS", toolCallId: id, delta: text }),
    close: () => [{ type: "TOOL_CALL_END", toolCallId: id }],
  },
  "Vercel `fullStream`": {
    integration: vercelAI,
    start: [{ type: "start-step" }, { type: "tool-input-start", id, toolName: "weather" }],
    delta: (text) => ({ type: "tool-input-delta", id, delta: text }),
    close: () => [{ type: "tool-input-end", id }],
  },
  "Vercel UI stream": {
    integration: vercelAI,
    start: [{ type: "start-step" }, { type: "tool-input-start", toolCallId: id, toolName: "weather" }],
    delta: (text) => ({ type: "tool-input-delta", toolCallId: id, inputTextDelta: text }),
    close: () => [{ type: "tool-input-end", toolCallId: id }],
    end: [{ type: "finish-step" }],
  },
  LangChain: {
    integration: langchain,
    start: [{ tool_call_chunks: [{ index: 0, id, name: "weather", args: "" }] }],
    delta: (text) => ({ tool_call_chunks: [{ index: 0, args: text }] }),
    close: () => [],
  },
  "assistant-ui": {
    integration: assistantUI,
    start: [{ type: "part-start", path: [], part: { type: "tool-call", toolCallId: id, toolName: "weather" } }],
    delta: (text) => ({ type: "text-delta", path: [0], textDelta: text }),
    close: () => [{ type: "tool-call-args-text-finish", path: [0] }],
  },
  "OpenAI Responses": {
    integration: openAI,
    start: [{ type: "response.output_item.added", item: { type: "function_call", id } }],
    delta: (text) => ({ type: "response.function_call_arguments.delta", item_id: id, delta: text }),
    close: (text) => [{ type: "response.function_call_arguments.done", item_id: id, arguments: text }],
  },
  "`defineAdapter`": {
    adapter: defineAdapter((event) => event.operations),
    start: [{ operations: [{ type: "start", id }] }],
    delta: (text) => ({ operations: [{ type: "delta", id, text }] }),
    close: () => [{ operations: [{ type: "end", id }] }],
  },
  "Mistral chat": {
    integration: mistralChat,
    start: [{ data: { choices: [{ index: 0, delta: { toolCalls: [{ index: 0, id, function: { name: "weather", arguments: "" } }] }, finishReason: null }] } }],
    delta: (text) => ({ data: { choices: [{ index: 0, delta: { toolCalls: [{ index: 0, id: "null", function: { name: "weather", arguments: text } }] }, finishReason: null }] } }),
    close: () => [{ data: { choices: [{ index: 0, delta: {}, finishReason: "tool_calls" }] } }],
  },
  "OpenAI Chat Completions": {
    integration: openAIChatCompletions,
    start: [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name: "weather", arguments: "" } }] }, finish_reason: null }] }],
    delta: (text) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: text } }] }, finish_reason: null }] }),
    close: () => [{ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }],
  },
};

const scenarios = {
  "Complete JSON": { deltas: ['{"city":', '"SF"}'], closed: false },
  "Incomplete JSON": { deltas: ['{"city":"S'], closed: false },
  "No text": { deltas: [], closed: false },
  "Whitespace only": { deltas: [" "], closed: false },
  "No text, closed": { deltas: [], closed: true },
  "Whitespace only, closed": { deltas: [" "], closed: true },
};

const readEndOfStreamTable = () => {
  const section = apiDoc.split("#### End of stream")[1];
  assert.ok(section, "API.md has an `End of stream` section");
  const lines = section.split("\n");
  const first = lines.findIndex((line) => line.startsWith("|"));
  const end = lines.findIndex((line, index) => index > first && !line.startsWith("|"));
  const rows = lines
    .slice(first, end)
    .map((line) => line.split(" | ").map((cell) => cell.replace(/^\| ?| ?\|$/g, "").trim()));
  const [header, , ...body] = rows;
  return { header, body };
};

const expectedOutcome = (cell) => {
  if (cell === "Completes") return { value: { city: "SF" } };
  if (cell === "`{}`") return { value: {} };
  const code = /^`([A-Z_]+)`$/.exec(cell)?.[1];
  assert.ok(code, `unrecognized end-of-stream outcome ${cell}`);
  return { code };
};

const run = async (spec, { deltas, closed }) => {
  const text = deltas.join("");
  const events = [
    ...spec.start,
    ...deltas.map(spec.delta),
    ...(closed ? spec.close(text) : []),
    ...(spec.end ?? []),
  ];
  const options = spec.adapter ? { adapter: spec.adapter } : { integration: spec.integration };
  const completions = [];
  try {
    for await (const update of readStructured(events, options)) {
      if (update.type === "complete") completions.push(update);
    }
  } catch (error) {
    return { code: error.code };
  }
  assert.equal(completions.length, 1, "exactly one completion");
  assert.equal(completions[0].id, id);
  return { value: completions[0].value };
};

test("API.md end-of-stream table matches every adapter's behavior", async () => {
  const { header, body } = readEndOfStreamTable();
  assert.deepEqual(header.slice(0, 2), ["Adapter", "Closing event"]);
  assert.deepEqual(header.slice(2), Object.keys(scenarios));
  assert.deepEqual(body.map(([label]) => label).sort(), Object.keys(adapters).sort());

  for (const [label, , ...cells] of body) {
    for (const [index, name] of header.slice(2).entries()) {
      assert.deepEqual(
        await run(adapters[label], scenarios[name]),
        expectedOutcome(cells[index]),
        `${label}: ${name}`,
      );
    }
  }
});

test("API.md lists every StructuredStreamErrorCode", async () => {
  const types = await readFile(new URL("./index.d.ts", import.meta.url), "utf8");
  const union = /export type StructuredStreamErrorCode =([^;]+);/.exec(types)?.[1];
  assert.ok(union, "index.d.ts declares StructuredStreamErrorCode");
  const codes = [...union.matchAll(/"([A-Z_]+)"/g)].map(([, code]) => code);
  const list = /Error codes include ([\s\S]+?)\.\n/.exec(apiDoc)?.[1];
  assert.ok(list, "API.md has an error code list");
  const documented = new Set([...list.matchAll(/`([A-Z_]+)`/g)].map(([, code]) => code));
  assert.deepEqual(codes.filter((code) => !documented.has(code)), []);
});
