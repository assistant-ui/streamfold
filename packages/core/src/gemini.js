import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const gemini = (pool = createStructuredStreamPool()) => {
  const idsByIndex = new Map();

  return createIntegration(
    pool,
    (event, complete) => {
      if (
        event.event_type === "step.start" &&
        event.step.type === "function_call"
      ) {
        idsByIndex.set(event.index, event.step.id);
        const initial =
          typeof event.step.arguments === "string"
            ? event.step.arguments
            : event.step.arguments
              ? JSON.stringify(event.step.arguments)
              : "";
        return pool.start(event.step.id, initial);
      }

      if (
        event.event_type === "step.delta" &&
        event.delta.type === "arguments"
      ) {
        const id = idsByIndex.get(event.index);
        if (id !== undefined) {
          return pool.push(id, event.delta.partial_arguments);
        }
      }

      if (
        event.event_type === "interaction.completed" ||
        event.event_type === "interaction.complete"
      ) {
        for (const id of idsByIndex.values()) complete(id);
        idsByIndex.clear();
      }
      return undefined;
    },
    (complete) => {
      for (const id of idsByIndex.values()) complete(id);
      idsByIndex.clear();
    },
  );
};

export { gemini as createStructuredStream };
