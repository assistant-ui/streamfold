import { createStructuredStreamPool } from "./index.js";
import { append, createIntegration } from "./internal/integration.js";

export const openAI = (pool = createStructuredStreamPool(), options) =>
  createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "error" || event.type === "response.failed") {
        const failure = event.type === "error" ? event.error ?? event : event.response?.error;
        throw failure instanceof Error ? failure : new Error(
          failure?.message ?? "OpenAI response failed", { cause: failure },
        );
      }
      if (event.type === "response.incomplete") {
        const details = event.response?.incomplete_details;
        if (details?.reason === "steered") return undefined;
        throw new Error(
          `OpenAI response incomplete${details?.reason ? `: ${details.reason}` : ""}`,
          { cause: details },
        );
      }
      if (event.type === "response.output_item.added") {
        if (event.item.type !== "function_call") return undefined;
        return calls.start(event.item.id);
      }
      if (event.type === "response.function_call_arguments.delta") {
        return append(calls, event.item_id, event.delta);
      }
      if (event.type === "response.function_call_arguments.done") {
        return calls.complete(event.item_id, () => event.arguments);
      }
      return undefined;
    },
    undefined,
    "openai",
    options,
  );

export { openAI as createStructuredStream };
