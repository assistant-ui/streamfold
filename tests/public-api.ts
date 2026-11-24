import {
  createStructuredStream,
  createStructuredStreamPool,
  defineAdapter,
  readStructured,
  prepareStreamfold,
  isStructuredStreamError,
  DEFAULT_STREAM_LIMITS,
  STREAMFOLD_ENGINE,
  type JsonValue,
  type StructuredStreamIntegration,
} from "streamfold";
import type {
  BatchStructuredStream,
  ReadStructuredOptions,
  StructuredStreamAdapter,
  StructuredStreamDiagnostic,
  StructuredStreamMapper,
  StructuredStreamOperation,
  StructuredStreamOptions,
  StructuredStreamPoolOptions,
} from "streamfold";
import {
  assistantUI,
  initializeAssistantStream,
  disableAssistantStream,
  createStructuredStream as createAssistantUiStream,
} from "streamfold/assistant-ui";
import { createStructuredStream as createVercelAiStream, createToolInputParser } from "streamfold/vercel-ai";
import { agUI } from "streamfold/ag-ui";
import { anthropic } from "streamfold/anthropic";
import { cohere } from "streamfold/cohere";
import { gemini } from "streamfold/gemini";
import { langchain } from "streamfold/langchain";
import { openAI, openAIChatCompletions } from "streamfold/openai";
import type { AgUiToolCallEvent } from "streamfold/ag-ui";
import type { AssistantUiStreamEvent } from "streamfold/assistant-ui";
import type { CohereToolCallEvent } from "streamfold/cohere";
import type { GeminiToolCallEvent } from "streamfold/gemini";
import { adapterContractTests } from "streamfold/testing";
import type { AssistantStreamChunk } from "assistant-stream";

initializeAssistantStream satisfies () => Promise<boolean>;
disableAssistantStream satisfies () => void;
createToolInputParser satisfies () => { push(delta: string): unknown; dispose(): void };
const toolInput = createToolInputParser({ maxBytes: 1024, maxDepth: 8 });
toolInput.push('{"ok":true}') satisfies JsonValue | undefined;
toolInput.dispose();
// @ts-expect-error Embedded parsers always return immutable snapshots.
createToolInputParser({ snapshots: "live" });

declare const assistantSdkEvents: ReadableStream<AssistantStreamChunk>;
readStructured(assistantSdkEvents, { integration: assistantUI });

const scanner = createStructuredStream();
prepareStreamfold satisfies () => Promise<void>;
scanner.push('{"ok":');
scanner.push("true}");
scanner.finish();
scanner.getFieldState(["ok"]) satisfies "complete" | "partial";
scanner.backend satisfies "rust-wasm";
STREAMFOLD_ENGINE satisfies "rust-wasm";
scanner.dispose();

createStructuredStream({ maxBytes: 1024, maxDepth: 8 }).dispose();
createStructuredStream({ snapshots: "immutable" }).dispose();
// @ts-expect-error Snapshot modes are checked at the public boundary.
createStructuredStream({ snapshots: "typo" });
DEFAULT_STREAM_LIMITS.maxBytes satisfies number;

const pool = createStructuredStreamPool<string>({
  maxActiveStreams: 4,
  maxBytes: 1024,
  maxDepth: 8,
});
pool.start("call-1");
pool.push("call-1", '{"query":"streamfold"}');
pool.getFieldState("call-1", ["query"]) satisfies "complete" | "partial";
pool.finish("call-1", '{"query":"streamfold"}').value;

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
assistantUi.push({ type: "step-finish", path: [], finishReason: "error" });
assistantUi.push({ type: "message-finish", path: [], finishReason: "error" });

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
vercelAi.push({ type: "finish-step" });
vercelAi.push({ type: "finish", finishReason: "error" });

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
// @ts-expect-error Operation IDs cannot be undefined.
defineAdapter((event: { callId?: string }) => [{ type: "start", id: event.callId }]);
// @ts-expect-error Operation IDs cannot be null.
defineAdapter((event: WeatherEvent) => [{ type: "end", id: null }]);

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
createStructuredStream(gemini).pushAll({
  event_type: "interaction.status_update",
  interaction_id: "interaction",
  status: "failed",
});
createStructuredStream(langchain).pushAll({ tool_call_chunks: [] });
createStructuredStream(openAI).pushAll({ type: "response.completed" });
// Custom integrations written before pushAll remain source-compatible.
const legacyIntegration: StructuredStreamIntegration<string> = () => ({
  push: () => undefined,
  finish: () => [],
});
createStructuredStream(legacyIntegration).push("custom");

weatherAdapter({ snapshots: "immutable" });
readStructured(weatherEvents, {
  adapter: weatherAdapter,
  limits: { snapshots: "immutable" },
});
readStructured([], {
  integration: assistantUI,
  limits: { snapshots: "immutable" },
});

const onDiagnostic = (
  diagnostic: import("streamfold").StructuredStreamDiagnostic,
) => {
  diagnostic.adapter satisfies string;
  if (isStructuredStreamError(diagnostic.error)) {
    diagnostic.error.code satisfies string;
    diagnostic.error.byteOffset satisfies number | undefined;
  }
};
weatherAdapter({ snapshots: "immutable", onDiagnostic });
createVercelAiStream(pool, { onDiagnostic });
readStructured(weatherEvents, { adapter: weatherAdapter, onDiagnostic });
readStructured([], { integration: assistantUI, onDiagnostic });
adapterContractTests({
  adapter: defineAdapter((operations: readonly StructuredStreamOperation[]) => operations),
  encode: (operations) => [operations],
})[0]?.run() satisfies Promise<void> | undefined;
readStructured(weatherEvents, { adapter: weatherAdapter, signal: new AbortController().signal });
readStructured([], { integration: assistantUI, signal: new AbortController().signal });
// @ts-expect-error cancellation requires an AbortSignal
readStructured(weatherEvents, { adapter: weatherAdapter, signal: "stop" });

// Under exactOptionalPropertyTypes, optional fields the runtime treats as
// absent when undefined also accept an explicit undefined.
// @ts-expect-error These cases are meaningful only with exactOptionalPropertyTypes on.
({ maxBytes: undefined }) satisfies { maxBytes?: number };
declare const maybeLimit: number | undefined;
declare const maybeSnapshots: "live" | "immutable" | undefined;
declare const maybeSignal: AbortSignal | undefined;
declare const maybeLimits: StructuredStreamPoolOptions | undefined;
declare const maybeOnDiagnostic: ((diagnostic: StructuredStreamDiagnostic) => void) | undefined;
declare const maybeString: string | undefined;
createStructuredStream({ maxBytes: maybeLimit, maxDepth: maybeLimit, snapshots: maybeSnapshots }).dispose();
createStructuredStream(undefined).dispose();
const forwardOptions = (options?: StructuredStreamOptions) => createStructuredStream(options);
forwardOptions().dispose();
createStructuredStreamPool({ maxActiveStreams: maybeLimit, maxBytes: maybeLimit });
createToolInputParser({ maxBytes: maybeLimit, maxDepth: maybeLimit }).dispose();
weatherAdapter({ maxActiveStreams: maybeLimit, onDiagnostic: maybeOnDiagnostic });
createVercelAiStream(pool, { onDiagnostic: maybeOnDiagnostic });
readStructured(weatherEvents, {
  adapter: weatherAdapter,
  integration: undefined,
  signal: maybeSignal,
  limits: maybeLimits,
  onDiagnostic: maybeOnDiagnostic,
});
readStructured([], {
  integration: assistantUI,
  adapter: undefined,
  signal: maybeSignal,
  limits: { maxBytes: maybeLimit, maxActiveStreams: maybeLimit, snapshots: maybeSnapshots },
  onDiagnostic: maybeOnDiagnostic,
});
DEFAULT_STREAM_LIMITS.maxActiveStreams satisfies number;
// @ts-expect-error Exactly one factory is still required.
readStructured([], { adapter: undefined, integration: undefined });
// @ts-expect-error Snapshot modes stay a closed union.
createStructuredStream({ snapshots: maybeString });

createStructuredStream(langchain).pushAll({
  tool_call_chunks: [{ type: undefined, index: undefined, id: maybeString, name: undefined, args: maybeString }],
});
createStructuredStream(langchain).pushAll({ tool_call_chunks: undefined });
createStructuredStream(openAIChatCompletions).pushAll({
  choices: [{
    index: 0,
    finish_reason: undefined,
    delta: {
      content: undefined,
      tool_calls: [{ index: 0, id: maybeString, type: undefined, function: { name: undefined, arguments: maybeString } }],
    },
  }],
});
createStructuredStream(openAIChatCompletions).pushAll({ error: { message: undefined } });
createStructuredStream(agUI).pushAll({ type: "STEP_STARTED", toolCallId: undefined });
createVercelAiStream().pushAll({ type: "start", id: undefined, toolCallId: undefined });
const assistantUiError = {
  type: "error",
  path: [],
  error: "failed",
  code: maybeString,
  severity: undefined,
} satisfies Extract<AssistantUiStreamEvent, { type: "error" }>;
createAssistantUiStream().pushAll(assistantUiError);
const agUiRunError = {
  type: "RUN_ERROR",
  message: "failed",
  code: maybeString,
} satisfies Extract<AgUiToolCallEvent, { type: "RUN_ERROR" }>;
createStructuredStream(agUI).pushAll(agUiRunError);
const cohereStart = {
  type: "tool-call-start",
  index: maybeLimit,
  delta: { message: { toolCalls: { id: maybeString, function: { arguments: maybeString } }, tool_calls: undefined } },
} satisfies Extract<CohereToolCallEvent, { type: "tool-call-start" | "tool-call-delta" }>;
createStructuredStream(cohere).pushAll(cohereStart);
const geminiStart = {
  event_type: "step.start",
  index: 0,
  step: { type: "function_call", id: "call-1", arguments: maybeString },
} satisfies Extract<GeminiToolCallEvent, { event_type: "step.start" }>;
createStructuredStream(gemini).pushAll(geminiStart);
