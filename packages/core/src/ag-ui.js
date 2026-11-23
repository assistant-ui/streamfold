import { createStructuredStreamPool } from "./index.js";
import { createEmptyArguments, createIntegration } from "./internal/integration.js";

export const agUI = (pool = createStructuredStreamPool(), options) => {
  const emptyArguments = createEmptyArguments();
  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "RUN_ERROR") {
        throw new Error(event.message ?? "AG-UI run failed", { cause: event });
      }
      if (event.type === "TOOL_CALL_START")
        return emptyArguments.start(calls.start(event.toolCallId), event.toolCallId);
      if (event.type === "TOOL_CALL_ARGS") {
        return emptyArguments.push(
          calls.push(event.toolCallId, event.delta),
          event.toolCallId,
          event.delta,
        );
      }
      if (event.type === "TOOL_CALL_END")
        return calls.complete(event.toolCallId, emptyArguments.finalChunk(event.toolCallId));
      return undefined;
    },
    (complete) => {
      for (const id of pool.activeIds) complete(id, emptyArguments.finalChunk(id));
      emptyArguments.clear();
    },
    "ag-ui",
    options,
    () => emptyArguments.clear(),
  );
};

export { agUI as createStructuredStream };
