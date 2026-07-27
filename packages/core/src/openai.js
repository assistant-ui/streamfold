import { createStructuredStreamPool } from "./index.js";
import { append, createIntegration } from "./internal/integration.js";

export const openAI = (pool = createStructuredStreamPool()) =>
  createIntegration(pool, (event, complete) => {
    if (event.type === "response.output_item.added") {
      if (event.item.type !== "function_call") return undefined;
      return pool.start(event.item.id);
    }
    if (event.type === "response.function_call_arguments.delta") {
      return append(pool, event.item_id, event.delta);
    }
    if (event.type === "response.function_call_arguments.done") {
      if (!pool.has(event.item_id)) pool.start(event.item_id, event.arguments);
      return complete(event.item_id);
    }
    return undefined;
  });

export { openAI as createStructuredStream };
