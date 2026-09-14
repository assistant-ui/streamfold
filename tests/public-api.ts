import {
  createStructuredStream,
  createStructuredStreamPool,
  defineAdapter,
  DEFAULT_STREAM_LIMITS,
  STREAMFOLD_ENGINE,
} from "streamfold";
import type {
  BatchStructuredStream,
  StructuredStreamAdapter,
  StructuredStreamMapper,
  StructuredStreamOperation,
} from "streamfold";
import {
  assistantUI,
  createStructuredStream as createAssistantUiStream,
} from "streamfold/assistant-ui";
import { createStructuredStream as createVercelAiStream } from "streamfold/vercel-ai";

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
[{ type: "start", id: "call" }] as const satisfies readonly StructuredStreamOperation[];

// @ts-expect-error Events must match the mapper's input.
weather.pushAll({ kind: "piece", id: "wrong", text: "{}" });
// @ts-expect-error A delta operation requires text.
defineAdapter((event: WeatherEvent) => [{ type: "delta", id: 1 }]);
// @ts-expect-error Operation names are a closed union.
defineAdapter((event: WeatherEvent) => [{ type: "piece", id: 1 }]);
