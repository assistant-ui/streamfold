import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const vercelAI = (pool = createStructuredStreamPool(), options) =>
  createIntegration(
    pool,
    (event, calls) => {
      const id = event.id ?? event.toolCallId;
      if (id === undefined) {
        if (
          [
            "tool-input-start",
            "tool-input-delta",
            "tool-input-end",
            "tool-input-available",
          ].includes(event.type)
        ) {
          calls.unmatched("Tool input event is missing its call id");
        }
        return undefined;
      }

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
    },
    undefined,
    "vercel-ai",
    options,
  );

export { vercelAI as createStructuredStream };
