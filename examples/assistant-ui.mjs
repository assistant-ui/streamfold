import { readStructured } from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";

/** @type {import('assistant-stream').AssistantStreamChunk[]} */
export const events = [
  { type: "part-start", path: [0], part: { type: "text" } },
  { type: "text-delta", path: [0], textDelta: "Checking the weather." },
  { type: "part-start", path: [1], part: { type: "tool-call", toolCallId: "weather", toolName: "getWeather" } },
  { type: "text-delta", path: [1], textDelta: '{"city":"San' },
  { type: "text-delta", path: [1], textDelta: ' Francisco"}' },
  { type: "tool-call-args-text-finish", path: [1] },
];

/**
 * @param {AsyncIterable<import('assistant-stream').AssistantStreamChunk> | Iterable<import('assistant-stream').AssistantStreamChunk>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source = events, options = {}) {
  return readStructured(source, {
    integration: assistantUI,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
