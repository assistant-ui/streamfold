import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const langchain = (pool = createStructuredStreamPool()) => {
  const idsByIndex = new Map();

  return createIntegration(
    pool,
    (message, calls) => {
      let update;
      for (const chunk of message.tool_call_chunks ?? []) {
        let id = idsByIndex.get(chunk.index);
        if (id === undefined && chunk.id) {
          id = chunk.id;
          idsByIndex.set(chunk.index, id);
          update = calls.start(id);
        }
        if (id !== undefined && chunk.args) {
          update = calls.push(id, chunk.args);
        }
      }
      return update;
    },
    (complete) => {
      for (const id of idsByIndex.values()) complete(id);
      idsByIndex.clear();
    },
  );
};

export { langchain as createStructuredStream };
