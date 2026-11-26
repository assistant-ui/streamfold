import { readStructured } from "streamfold";
import { agUI } from "streamfold/ag-ui";

/**
 * @param {AsyncIterable<import("@tanstack/ai").StreamChunk>} events
 * @returns {AsyncGenerator<import("streamfold/ag-ui").AgUiToolCallEvent>}
 */
async function* toolEvents(events) {
  for await (const event of events) {
    switch (event.type) {
      case "TOOL_CALL_START":
      case "TOOL_CALL_ARGS":
      case "TOOL_CALL_END":
      case "RUN_ERROR":
        yield event;
    }
  }
}

/**
 * @param {AsyncIterable<import("@tanstack/ai").StreamChunk>} events
 * @param {AbortController} abortController The controller passed to this chat run.
 */
export async function* readToolInputs(events, abortController) {
  let finished = false;
  try {
    yield* readStructured(toolEvents(events), {
      integration: agUI,
      limits: { snapshots: "immutable" },
      signal: abortController.signal,
    });
    finished = true;
  } finally {
    if (!finished) abortController.abort();
  }
}
