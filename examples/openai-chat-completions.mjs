import { readStructured } from "streamfold";
import { openAIChatCompletions } from "streamfold/openai";

/**
 * @param {AsyncIterable<import('openai/resources/chat/completions').ChatCompletionChunk>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source, options = {}) {
  return readStructured(source, {
    integration: openAIChatCompletions,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
