import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const langchain = (pool = createStructuredStreamPool(), options) => {
  const idsByIndex = new Map();
  const emptyArguments = new Set();

  const finishCall = (complete, id) => {
    const result = complete(id, emptyArguments.has(id) ? () => "{}" : undefined);
    emptyArguments.delete(id);
    return result;
  };

  return createIntegration(
    pool,
    (message, calls) => {
      let update;
      for (const chunk of message.tool_call_chunks ?? []) {
        let id = idsByIndex.get(chunk.index);
        if (chunk.id && chunk.id !== id) {
          // LangChain's concat keeps a new id at a known index as a separate
          // call, so the previous call is finished before the index moves on.
          if (id !== undefined) update = finishCall(calls.complete, id);
          id = chunk.id;
          if (chunk.index !== undefined) idsByIndex.set(chunk.index, id);
          if (!calls.has(id)) {
            update = calls.start(id);
            emptyArguments.add(id);
          }
        }
        if (id !== undefined && chunk.args) {
          if (chunk.args.trim() !== "") emptyArguments.delete(id);
          update = calls.push(id, chunk.args);
        } else if (id === undefined && chunk.args) {
          calls.unmatched("Arguments delta has no matching tool call index");
        }
      }
      return update;
    },
    (complete) => {
      for (const id of idsByIndex.values()) finishCall(complete, id);
      for (const id of pool.activeIds) finishCall(complete, id);
      idsByIndex.clear();
      emptyArguments.clear();
    },
    "langchain",
    options,
    () => {
      idsByIndex.clear();
      emptyArguments.clear();
    },
  );
};

export { langchain as createStructuredStream };
