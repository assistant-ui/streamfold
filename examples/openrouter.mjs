import { readStructured } from "streamfold";
import { openRouter } from "streamfold/openrouter";

/**
 * @param {AsyncIterable<import('streamfold/openrouter').OpenRouterChatEvent>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source, options = {}) {
  return readStructured(source, {
    integration: openRouter,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
