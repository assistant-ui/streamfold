import { readStructured } from "streamfold";
import { mistralChat } from "streamfold/mistral";

/**
 * @param {AsyncIterable<import("@mistralai/mistralai/models/components").CompletionEvent>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source, options = {}) {
  return readStructured(source, {
    integration: mistralChat,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
