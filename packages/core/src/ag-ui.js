import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const agUI = (pool = createStructuredStreamPool()) =>
  createIntegration(pool, (event, calls) => {
    if (event.type === "TOOL_CALL_START") return calls.start(event.toolCallId);
    if (event.type === "TOOL_CALL_ARGS") {
      return calls.push(event.toolCallId, event.delta);
    }
    if (event.type === "TOOL_CALL_END") return calls.complete(event.toolCallId);
    return undefined;
  });

export { agUI as createStructuredStream };
