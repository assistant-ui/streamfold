import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const langchain = (pool = createStructuredStreamPool(), options) => {
  const idsByIndex = new Map();
  const emptyArguments = new Set();

  return createIntegration(
    pool,
    (message, calls) => {
      let update;
      for (const chunk of message.tool_call_chunks ?? []) {
        let id = idsByIndex.get(chunk.index);
        if (id === undefined && chunk.id) {
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
      const completeCall = (id) =>
        complete(id, emptyArguments.has(id) ? () => "{}" : undefined);
      for (const id of idsByIndex.values()) completeCall(id);
      for (const id of pool.activeIds) completeCall(id);
      idsByIndex.clear();
      emptyArguments.clear();
    },
    "langchain",
    options,
  );
};

export { langchain as createStructuredStream };
