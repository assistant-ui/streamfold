import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const vercelAI = (pool = createStructuredStreamPool()) =>
  createIntegration(pool, (event, calls) => {
    const id = event.id ?? event.toolCallId;
    if (id === undefined) return undefined;

    if (event.type === "tool-input-start") return calls.start(id);
    if (event.type === "tool-input-delta") {
      return calls.push(id, event.delta ?? event.inputTextDelta);
    }
    if (
      event.type === "tool-input-end" ||
      event.type === "tool-input-available"
    ) {
      return calls.complete(id);
    }
    return undefined;
  });

export { vercelAI as createStructuredStream };
