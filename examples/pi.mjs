import { readStructured } from "streamfold";
import { pi } from "streamfold/pi";

/**
 * @param {(signal: AbortSignal) => AsyncIterable<import('@earendil-works/pi-ai').AssistantMessageEvent>} openStream
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function* readToolInputs(openStream, { signal } = {}) {
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  requestSignal.throwIfAborted();
  try {
    yield* readStructured(openStream(requestSignal), {
      integration: pi,
      limits: { snapshots: "immutable" },
      signal: requestSignal,
    });
  } finally {
    // Returning Pi's event iterator alone does not cancel the provider request.
    controller.abort();
  }
}
