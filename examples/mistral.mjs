import { readStructured } from "streamfold";
import { openAI } from "streamfold/openai";

/** @typedef {import('@mistralai/mistralai/models/components').ResponsesStreamFrame} MistralFrame */

/** @param {MistralFrame} frame */
function normalizeEvent({ data }) {
  if (
    data.type === "response.function_call_arguments.delta" ||
    data.type === "response.function_call_arguments.done"
  ) {
    return { ...data, item_id: data.itemId };
  }
  if (data.type === "response.incomplete") {
    return {
      ...data,
      response: { ...data.response, incomplete_details: data.response.incompleteDetails },
    };
  }
  return data;
}

/** @type {import("streamfold").BatchStructuredStreamIntegration<MistralFrame>} */
const mistral = (pool, options) => {
  const stream = openAI(pool, options);
  const { push, pushAll } = stream;
  // Keep the integration instance so the managed reader can dispose its state.
  return Object.assign(stream, {
    /** @param {MistralFrame} frame */
    push: (frame) => push(normalizeEvent(frame)),
    /** @param {MistralFrame} frame */
    pushAll: (frame) => pushAll(normalizeEvent(frame)),
  });
};

/**
 * @param {AsyncIterable<MistralFrame>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source, options = {}) {
  return readStructured(source, {
    integration: mistral,
    limits: { snapshots: "immutable" },
    ...options,
  });
}
