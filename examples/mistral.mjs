import { readStructured } from "streamfold";
import { openAI } from "streamfold/openai";

/**
 * @param {AsyncIterable<import('@mistralai/mistralai/models/components').ResponsesStreamFrame>} source
 */
async function* normalizeEvents(source) {
  for await (const { data } of source) {
    if (data.type === "response.function_call_arguments.delta" ||
        data.type === "response.function_call_arguments.done") {
      yield { ...data, item_id: data.itemId };
    } else {
      yield data;
    }
  }
}

/**
 * @param {AsyncIterable<import('@mistralai/mistralai/models/components').ResponsesStreamFrame>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source, options = {}) {
  return readStructured(normalizeEvents(source), {
    integration: openAI,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
