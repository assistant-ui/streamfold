import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const agUI = (pool = createStructuredStreamPool()) =>
  createIntegration(pool, (event, complete) => {
    if (event.type === "TOOL_CALL_START") return pool.start(event.toolCallId);
    if (event.type === "TOOL_CALL_ARGS") {
      return pool.push(event.toolCallId, event.delta);
    }
    if (event.type === "TOOL_CALL_END") return complete(event.toolCallId);
    return undefined;
  });

export { agUI as createStructuredStream };
