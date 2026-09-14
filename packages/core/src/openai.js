import { createStructuredStreamPool } from "./index.js";
import { append, createIntegration } from "./internal/integration.js";

export const openAI = (pool = createStructuredStreamPool(), options) =>
  createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "response.output_item.added") {
        if (event.item.type !== "function_call") return undefined;
        return calls.start(event.item.id);
      }
      if (event.type === "response.function_call_arguments.delta") {
        return append(calls, event.item_id, event.delta);
      }
      if (event.type === "response.function_call_arguments.done") {
        if (!calls.has(event.item_id))
          calls.start(event.item_id, event.arguments);
        return calls.complete(event.item_id);
      }
      return undefined;
    },
    undefined,
    "openai",
    options,
  );

export { openAI as createStructuredStream };
