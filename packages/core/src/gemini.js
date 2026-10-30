import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const gemini = (pool = createStructuredStreamPool(), options) => {
  const callsByIndex = new Map();
  const completeCalls = (complete) => {
    for (const { id, emptyArguments } of callsByIndex.values()) {
      complete(id, emptyArguments ? () => "{}" : undefined);
    }
    callsByIndex.clear();
  };

  return createIntegration(
    pool,
    (event, calls) => {
      if (
        event.event_type === "step.start" &&
        event.step.type === "function_call"
      ) {
        const initial =
          typeof event.step.arguments === "string"
            ? event.step.arguments
            : event.step.arguments
              ? JSON.stringify(event.step.arguments)
              : "";
        const emptyArguments =
          typeof event.step.arguments === "object" && initial === "{}";
        callsByIndex.set(event.index, { id: event.step.id, emptyArguments });
        return calls.start(event.step.id, emptyArguments ? "" : initial);
      }

      if (
        event.event_type === "step.delta" &&
        (event.delta.type === "arguments_delta" || event.delta.type === "arguments")
      ) {
        const call = callsByIndex.get(event.index);
        if (call !== undefined) {
          const text = event.delta.type === "arguments_delta"
            ? event.delta.arguments ?? ""
            : event.delta.partial_arguments;
          if (text !== "") call.emptyArguments = false;
          return calls.push(call.id, text);
        }
        calls.unmatched("Arguments delta has no matching function call index");
      }

      if (
        event.event_type === "interaction.completed" ||
        event.event_type === "interaction.complete"
      ) {
        completeCalls(calls.complete);
      }
      return undefined;
    },
    completeCalls,
    "gemini",
    options,
  );
};

export { gemini as createStructuredStream };
