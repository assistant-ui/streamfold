import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

const pathKey = (path) => path.join("/");

export const assistantUI = (pool = createStructuredStreamPool()) => {
  const idsByPath = new Map();

  return createIntegration(pool, (event, complete) => {
    const key = pathKey(event.path);

    if (event.type === "part-start" && event.part.type === "tool-call") {
      idsByPath.set(key, event.part.toolCallId);
      return pool.start(event.part.toolCallId);
    }

    const id = idsByPath.get(key);
    if (id === undefined) return undefined;

    if (event.type === "text-delta") {
      return pool.push(id, event.textDelta);
    }
    if (event.type === "tool-call-args-text-finish") {
      idsByPath.delete(key);
      return complete(id);
    }
    return undefined;
  });
};

export { assistantUI as createStructuredStream };
