import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const langchain = (pool = createStructuredStreamPool()) => {
  const idsByIndex = new Map();

  return createIntegration(
    pool,
    (message) => {
      for (const chunk of message.tool_call_chunks ?? []) {
        let id = idsByIndex.get(chunk.index);
        if (id === undefined && chunk.id) {
          id = chunk.id;
          idsByIndex.set(chunk.index, id);
          pool.start(id);
        }
        if (id !== undefined && chunk.args) pool.push(id, chunk.args);
      }
      return undefined;
    },
    (complete) => {
      for (const id of idsByIndex.values()) complete(id);
      idsByIndex.clear();
    },
  );
};

export { langchain as createStructuredStream };
