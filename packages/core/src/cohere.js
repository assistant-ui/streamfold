import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const cohere = (pool = createStructuredStreamPool(), options) => {
  const idsByIndex = new Map();
  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "message-end" && event.delta?.error) throw new Error(event.delta.error);
      const message = event.delta?.message;
      const tool = message?.toolCalls ?? message?.tool_calls;
      if (event.type === "tool-call-start") {
        if (event.index === undefined) {
          calls.unmatched("Tool call start has no index");
          return undefined;
        }
        const id = tool?.id;
        if (id !== undefined) idsByIndex.set(event.index, id);
        return calls.start(id, tool?.function?.arguments ?? "");
      }
      if (event.type === "tool-call-delta") {
        const id = idsByIndex.get(event.index);
        if (id === undefined) {
          calls.unmatched("Arguments delta has no matching tool call index");
          return undefined;
        }
        return calls.push(id, tool?.function?.arguments ?? "");
      }
      if (event.type === "tool-call-end") {
        const id = idsByIndex.get(event.index);
        if (id !== undefined) {
          idsByIndex.delete(event.index);
          return calls.complete(id);
        }
      }
      return undefined;
    },
    (complete) => {
      for (const id of idsByIndex.values()) complete(id);
      idsByIndex.clear();
    },
    "cohere",
    options,
  );
};

export { cohere as createStructuredStream };
