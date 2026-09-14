import {
  createStructuredStream,
  createStructuredStreamPool,
  defineAdapter,
  readStructured,
  DEFAULT_STREAM_LIMITS,
  STREAMFOLD_ENGINE,
  type JsonValue,
  type StructuredStreamIntegration,
} from "streamfold";
import type {
  BatchStructuredStream,
  ReadStructuredOptions,
  StructuredStreamAdapter,
  StructuredStreamMapper,
  StructuredStreamOperation,
} from "streamfold";
import {
  assistantUI,
  createStructuredStream as createAssistantUiStream,
} from "streamfold/assistant-ui";
import { createStructuredStream as createVercelAiStream } from "streamfold/vercel-ai";
import { agUI } from "streamfold/ag-ui";
import { anthropic } from "streamfold/anthropic";
import { gemini } from "streamfold/gemini";
import { langchain } from "streamfold/langchain";
import { openAI } from "streamfold/openai";

const scanner = createStructuredStream();
scanner.push('{"ok":');
scanner.push("true}");
scanner.finish();
scanner.getFieldState(["ok"]) satisfies "complete" | "partial";
scanner.backend satisfies "rust-wasm";
STREAMFOLD_ENGINE satisfies "rust-wasm";
scanner.dispose();

createStructuredStream({ maxBytes: 1024, maxDepth: 8 }).dispose();
DEFAULT_STREAM_LIMITS.maxBytes satisfies number;

const pool = createStructuredStreamPool<string>({
  maxActiveStreams: 4,
  maxBytes: 1024,
  maxDepth: 8,
});
pool.start("call-1");
pool.push("call-1", '{"query":"streamfold"}');
pool.getFieldState("call-1", ["query"]) satisfies "complete" | "partial";
pool.finish("call-1").value;

const assistantUi = createAssistantUiStream();
assistantUi.push({
  type: "part-start",
  path: [0],
  part: {
    type: "tool-call",
    toolCallId: "call-1",
    toolName: "search",
  },
});
assistantUi.push({
  type: "text-delta",
  path: [0],
  textDelta: '{"query":"streamfold"}',
});
assistantUi.push({
  type: "tool-call-args-text-finish",
  path: [0],
});

const composed = createStructuredStream(assistantUI);
for (const update of composed.pushAll({
  type: "text-delta",
  path: [0],
  textDelta: "text",
})) {
  update.id satisfies string;
  update.partialValue satisfies JsonValue | undefined;
  if (update.type === "complete") {
    update.value satisfies JsonValue;
    update.text satisfies string;
  } else {
    // @ts-expect-error final values exist only on lifecycle completion
    update.value;
  }
}
composed.finish();

const vercelAi = createVercelAiStream();
vercelAi.push({
  type: "tool-input-start",
  id: "call-1",
  toolName: "search",
});
vercelAi.push({
  type: "tool-input-delta",
  id: "call-1",
  delta: '{"query":"streamfold"}',
});
vercelAi.push({
  type: "tool-input-end",
  id: "call-1",
});

type WeatherEvent =
  | { kind: "begin" | "done"; id: number }
  | { kind: "piece"; id: number; text: string }
  | { kind: "ping" };

const weatherMapper = ((event: WeatherEvent) => {
  switch (event.kind) {
    case "begin":
      return [{ type: "start", id: event.id }];
    case "piece":
      return [{ type: "delta", id: event.id, text: event.text }];
    case "done":
      return [{ type: "end", id: event.id }];
    default:
      return [];
  }
}) satisfies StructuredStreamMapper<WeatherEvent, number>;

const weatherAdapter = defineAdapter(weatherMapper);
weatherAdapter satisfies StructuredStreamAdapter<WeatherEvent, number>;
const weather = weatherAdapter({ maxActiveStreams: 4, maxBytes: 1024 });
weather satisfies BatchStructuredStream<WeatherEvent, number>;
for (const update of weather.pushAll({ kind: "begin", id: 1 })) {
  update.id satisfies number;
}
weather.finish()[0]?.id satisfies number | undefined;
weather.dispose();
createStructuredStream(weatherAdapter).dispose();
defineAdapter<WeatherEvent, number>(weatherMapper)();
defineAdapter((event: WeatherEvent) => [{ type: "abort", id: 1 }])();
[
  { type: "start", id: "call" },
] as const satisfies readonly StructuredStreamOperation[];

// @ts-expect-error Events must match the mapper's input.
weather.pushAll({ kind: "piece", id: "wrong", text: "{}" });
// @ts-expect-error A delta operation requires text.
defineAdapter((event: WeatherEvent) => [{ type: "delta", id: 1 }]);
// @ts-expect-error Operation names are a closed union.
defineAdapter((event: WeatherEvent) => [{ type: "piece", id: 1 }]);

const weatherEvents: WeatherEvent[] = [
  { kind: "begin", id: 1 },
  { kind: "piece", id: 1, text: "{}" },
  { kind: "done", id: 1 },
];
const readOptions = {
  adapter: weatherAdapter,
  limits: { maxActiveStreams: 8 },
} satisfies ReadStructuredOptions<WeatherEvent, number>;

for await (const update of readStructured(weatherEvents, readOptions)) {
  update.id satisfies number;
  update.partialValue;
  if ("value" in update) update.text satisfies string;
}

async function* asyncWeatherEvents() {
  yield* weatherEvents;
}
readStructured(asyncWeatherEvents(), { adapter: weatherAdapter });
readStructured(new ReadableStream<WeatherEvent>(), { adapter: weatherAdapter });

// @ts-expect-error The source must produce the mapper's input event type.
readStructured([{ unrelated: true }], { adapter: weatherAdapter });
// @ts-expect-error SDK integrations use the explicit integration option.
readStructured([], { adapter: assistantUI });
for await (const update of readStructured(
  [{ tool_call_chunks: [{ index: 0, id: "a", args: "{}" }] }],
  { integration: langchain, limits: { maxBytes: 1024 } },
)) {
  if (update.type === "complete") update.value satisfies JsonValue;
}
// @ts-expect-error Choose one factory contract, not both.
readStructured([], { adapter: weatherAdapter, integration: assistantUI });
readStructured(weatherEvents, {
  adapter: weatherAdapter,
  // @ts-expect-error Limits must be numbers.
  limits: { maxBytes: "10" },
});

createStructuredStream(agUI).pushAll({
  type: "TOOL_CALL_END",
  toolCallId: "a",
});
createStructuredStream(anthropic).pushAll({
  type: "content_block_stop",
  index: 0,
});
createStructuredStream(gemini).pushAll({ event_type: "interaction.completed" });
createStructuredStream(langchain).pushAll({ tool_call_chunks: [] });
createStructuredStream(openAI).pushAll({ type: "response.completed" });
// Custom integrations written before pushAll remain source-compatible.
const legacyIntegration: StructuredStreamIntegration<string> = () => ({
  push: () => undefined,
  finish: () => [],
});
createStructuredStream(legacyIntegration).push("custom");
