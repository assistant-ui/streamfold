import { createStructuredStreamPool } from "./index.js";
import { createEmptyArguments, createIntegration } from "./internal/integration.js";

export const bedrock = (pool = createStructuredStreamPool(), options) => {
  const idsByIndex = new Map();
  const emptyArguments = createEmptyArguments();
  return createIntegration(
    pool,
    (event, calls) => {
      const failure = event.internalServerException ?? event.modelStreamErrorException ??
        event.validationException ?? event.throttlingException ?? event.serviceUnavailableException;
      if (failure) throw failure instanceof Error ? failure : new Error(failure.message ?? "Bedrock stream failed");

      const messageStop = event.messageStop;
      if (messageStop?.stopReason === "malformed_model_output" || messageStop?.stopReason === "malformed_tool_use") {
        throw new Error(`Bedrock generation failed: ${messageStop.stopReason}`, { cause: messageStop });
      }

      const start = event.contentBlockStart;
      if (start?.start?.toolUse) {
        if (start.contentBlockIndex === undefined) {
          calls.unmatched("Tool block start has no content block index");
          return undefined;
        }
        const id = start.start.toolUse.toolUseId;
        if (id !== undefined) idsByIndex.set(start.contentBlockIndex, id);
        return emptyArguments.start(calls.start(id), id);
      }
      const delta = event.contentBlockDelta;
      if (delta?.delta?.toolUse) {
        const id = idsByIndex.get(delta.contentBlockIndex);
        if (id === undefined) {
          calls.unmatched("Arguments delta has no matching tool block index");
          return undefined;
        }
        const input = delta.delta.toolUse.input ?? "";
        return emptyArguments.push(calls.push(id, input), id, input);
      }
      const stop = event.contentBlockStop;
      if (stop) {
        const id = idsByIndex.get(stop.contentBlockIndex);
        if (id !== undefined) {
          idsByIndex.delete(stop.contentBlockIndex);
          return calls.complete(id, emptyArguments.finalChunk(id));
        }
      }
      return undefined;
    },
    (complete) => {
      for (const id of idsByIndex.values()) complete(id, emptyArguments.finalChunk(id));
      idsByIndex.clear();
      emptyArguments.clear();
    },
    "bedrock",
    options,
    () => {
      idsByIndex.clear();
      emptyArguments.clear();
    },
  );
};

export { bedrock as createStructuredStream };
