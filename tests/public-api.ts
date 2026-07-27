import {
  createStructuredStream,
  createStructuredStreamPool,
  STREAMFOLD_ENGINE,
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
scanner.backend satisfies "rust-wasm";
STREAMFOLD_ENGINE satisfies "rust-wasm";
scanner.dispose();

const pool = createStructuredStreamPool<string>();
pool.start("call-1");
pool.push("call-1", '{"query":"streamfold"}');
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
