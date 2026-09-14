import { readStructured } from "streamfold";
import { vercelAI } from "streamfold/vercel-ai";

/** @type {import('ai').UIMessageChunk[]} */
export const events = [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: "Checking the weather." },
  { type: "tool-input-start", toolCallId: "weather", toolName: "getWeather" },
  { type: "tool-input-delta", toolCallId: "weather", inputTextDelta: '{"city":"San' },
  { type: "tool-input-delta", toolCallId: "weather", inputTextDelta: ' Francisco"}' },
  { type: "tool-input-available", toolCallId: "weather", toolName: "getWeather", input: { city: "San Francisco" } },
];

/**
 * @param {AsyncIterable<import('ai').UIMessageChunk> | Iterable<import('ai').UIMessageChunk>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source = events, options = {}) {
  return readStructured(source, {
    integration: vercelAI,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
