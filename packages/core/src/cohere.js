import { createStructuredStreamPool } from "./index.js";
import { createEmptyArguments, createIntegration } from "./internal/integration.js";

export const cohere = (pool = createStructuredStreamPool(), options) => {
  const idsByIndex = new Map();
  const emptyArguments = createEmptyArguments();
  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "message-end") {
        const details = event.delta;
        const reason = details?.finishReason ?? details?.finish_reason;
        if (details?.error || reason === "ERROR" || reason === "TIMEOUT") {
          throw new Error(details?.error || `Cohere generation failed: ${reason}`, { cause: details });
        }
      }
      const message = event.delta?.message;
      const tool = message?.toolCalls ?? message?.tool_calls;
      if (event.type === "tool-call-start") {
        if (event.index === undefined) {
          calls.unmatched("Tool call start has no index");
          return undefined;
        }
        const id = tool?.id;
        if (id !== undefined) idsByIndex.set(event.index, id);
        const initial = tool?.function?.arguments ?? "";
        return emptyArguments.start(calls.start(id, initial), id, initial);
      }
      if (event.type === "tool-call-delta") {
        const id = idsByIndex.get(event.index);
        if (id === undefined) {
          calls.unmatched("Arguments delta has no matching tool call index");
          return undefined;
        }
        const delta = tool?.function?.arguments ?? "";
        return emptyArguments.push(calls.push(id, delta), id, delta);
      }
      if (event.type === "tool-call-end") {
        const id = idsByIndex.get(event.index);
        if (id !== undefined) {
          idsByIndex.delete(event.index);
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
    "cohere",
    options,
    () => {
      idsByIndex.clear();
      emptyArguments.clear();
    },
  );
};

export { cohere as createStructuredStream };
