import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const bedrock = (pool = createStructuredStreamPool(), options) => {
  const idsByIndex = new Map();
  return createIntegration(
    pool,
    (event, calls) => {
      const failure = event.internalServerException ?? event.modelStreamErrorException ??
        event.validationException ?? event.throttlingException ?? event.serviceUnavailableException;
      if (failure) throw failure instanceof Error ? failure : new Error(failure.message ?? "Bedrock stream failed");

      const start = event.contentBlockStart;
      if (start?.start?.toolUse) {
        if (start.contentBlockIndex === undefined) {
          calls.unmatched("Tool block start has no content block index");
          return undefined;
        }
        const id = start.start.toolUse.toolUseId;
        if (id !== undefined) idsByIndex.set(start.contentBlockIndex, id);
        return calls.start(id);
      }
      const delta = event.contentBlockDelta;
      if (delta?.delta?.toolUse) {
        const id = idsByIndex.get(delta.contentBlockIndex);
        if (id === undefined) {
          calls.unmatched("Arguments delta has no matching tool block index");
          return undefined;
        }
        return calls.push(id, delta.delta.toolUse.input ?? "");
      }
      const stop = event.contentBlockStop;
      if (stop) {
        const id = idsByIndex.get(stop.contentBlockIndex);
        if (id !== undefined) {
          idsByIndex.delete(stop.contentBlockIndex);
          return calls.complete(id);
        }
      }
      return undefined;
    },
    (complete) => {
      for (const id of idsByIndex.values()) complete(id);
      idsByIndex.clear();
    },
    "bedrock",
    options,
  );
};

export { bedrock as createStructuredStream };
