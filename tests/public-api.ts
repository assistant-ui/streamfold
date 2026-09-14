import {
  createStructuredStream,
  createStructuredStreamPool,
  DEFAULT_STREAM_LIMITS,
  STREAMFOLD_ENGINE,
  isStructuredStreamError,
  type JsonValue,
  type StructuredStreamIntegration,
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
createStructuredStream({ snapshots: "immutable" }).dispose();
// @ts-expect-error snapshot modes are checked at the public boundary
createStructuredStream({ snapshots: "typo" });
DEFAULT_STREAM_LIMITS.maxBytes satisfies number;

const pool = createStructuredStreamPool<string>({
  maxActiveStreams: 4,
  maxBytes: 1024,
  maxDepth: 8,
  snapshots: "immutable",
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

const vercelAi = createVercelAiStream(pool, {
  onDiagnostic(diagnostic) {
    diagnostic.adapter satisfies string;
    diagnostic.message satisfies string;
    diagnostic.error satisfies Error | undefined;
    if (isStructuredStreamError(diagnostic.error)) {
      diagnostic.error.code satisfies string;
      diagnostic.error.byteOffset satisfies number | undefined;
      diagnostic.error.id satisfies unknown;
    }
  },
});
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
