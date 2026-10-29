import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const vercelAI = (pool = createStructuredStreamPool(), options) => {
  let inStep = false;
  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "start-step") {
        inStep = true;
        return undefined;
      }
      if (event.type === "finish-step") {
        for (const id of pool.activeIds) calls.complete(id);
        inStep = false;
        return undefined;
      }
      const id = event.id ?? event.toolCallId;
      if (id === undefined) {
        if (
          [
            "tool-input-start",
            "tool-input-delta",
            "tool-input-end",
            "tool-input-available",
            "tool-call",
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
      if (event.type === "tool-input-available" || event.type === "tool-call") {
        return calls.complete(id, () => JSON.stringify(event.input));
      }
      if (event.type === "tool-input-end" && !inStep) return calls.complete(id);
      return undefined;
    },
    undefined,
    "vercel-ai",
    options,
  );
};

export { vercelAI as createStructuredStream };
