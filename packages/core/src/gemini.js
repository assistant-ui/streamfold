import { createStructuredStreamPool } from "./index.js";
import { streamError } from "./internal/errors.js";
import { createIntegration } from "./internal/integration.js";

export const gemini = (pool = createStructuredStreamPool(), options) => {
  const callsByIndex = new Map();
  const completeCalls = (complete, endOfStream = false) => {
    for (const { id, emptyArguments, stopped } of callsByIndex.values()) {
      if (endOfStream && emptyArguments && !stopped) {
        throw streamError(
          new Error(
            `Gemini stream ended before step.stop for function call ${id}; consume the complete SDK stream or abort it.`,
          ),
          "INTEGRATION_ERROR",
          { id },
        );
      }
      complete(id, emptyArguments ? () => "{}" : undefined);
    }
    callsByIndex.clear();
  };

  return createIntegration(
    pool,
    (event, calls) => {
      if (event.event_type === "error") {
        throw new Error(event.error?.message ?? "Gemini stream failed", { cause: event.error });
      }
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
        callsByIndex.set(event.index, {
          id: event.step.id,
          emptyArguments,
          stopped: false,
        });
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

      if (event.event_type === "step.stop") {
        const call = callsByIndex.get(event.index);
        if (call !== undefined) call.stopped = true;
        return undefined;
      }

      if (
        event.event_type === "interaction.completed" ||
        event.event_type === "interaction.complete" ||
        event.event_type === "interaction.status_update"
      ) {
        const interaction = event.event_type === "interaction.status_update" ? event : event.interaction;
        if (["failed", "cancelled", "incomplete", "budget_exceeded"].includes(interaction?.status)) {
          throw new Error(`Gemini interaction ${interaction.status}`, { cause: interaction });
        }
        if (event.event_type !== "interaction.status_update") completeCalls(calls.complete);
      }
      return undefined;
    },
    (complete) => completeCalls(complete, true),
    "gemini",
    options,
    () => callsByIndex.clear(),
  );
};

export { gemini as createStructuredStream };
