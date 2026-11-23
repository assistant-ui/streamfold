import { createStructuredStream, createStructuredStreamPool } from "./index.js";
import { annotateError } from "./internal/errors.js";
import { createEmptyArguments, createIntegration } from "./internal/integration.js";

export const vercelAI = (pool = createStructuredStreamPool(), options) => {
  let inStep = false;
  const emptyArguments = createEmptyArguments();
  const completePending = (complete) => {
    for (const id of pool.activeIds) complete(id, emptyArguments.finalChunk(id));
  };
  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "abort") {
        throw new Error(event.reason ?? "Vercel AI stream aborted", { cause: event });
      }
      if (
        event.type === "error" ||
        event.type === "tool-input-error" ||
        (event.type === "tool-call" && event.invalid === true)
      ) {
        const failure = event.error;
        throw annotateError(
          failure instanceof Error ? failure : new Error(
            event.errorText ?? (typeof failure === "string" ? failure : failure?.message) ?? "Vercel AI stream failed",
          ),
          { id: event.id ?? event.toolCallId },
        );
      }
      if (event.type === "start-step") {
        inStep = true;
        return undefined;
      }
      if (event.type === "finish-step" || event.type === "finish") {
        if (event.finishReason === "error") {
          throw new Error("Vercel AI generation failed", { cause: event });
        }
        // UI step endings omit the reason; pending inputs must wait for finish or EOF.
        if (event.type === "finish" || typeof event.finishReason === "string") {
          completePending(calls.complete);
        }
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

      if (event.type === "tool-input-start") return emptyArguments.start(calls.start(id), id);
      if (event.type === "tool-input-delta") {
        const delta = event.delta ?? event.inputTextDelta;
        return emptyArguments.push(calls.push(id, delta), id, delta);
      }
      if (event.type === "tool-input-available" || event.type === "tool-call") {
        emptyArguments.delete(id);
        return calls.complete(id, () => JSON.stringify(event.input));
      }
      if (event.type === "tool-input-end" && !inStep) {
        return calls.complete(id, emptyArguments.finalChunk(id));
      }
      return undefined;
    },
    (complete) => {
      completePending(complete);
      emptyArguments.clear();
    },
    "vercel-ai",
    options,
    () => emptyArguments.clear(),
  );
};

export { vercelAI as createStructuredStream };

export const createToolInputParser = (options = {}) => {
  const parser = createStructuredStream({ ...options, snapshots: "immutable" });
  return {
    push(delta) {
      const update = parser.push(delta);
      for (const { path } of update.changes) {
        if (path.some((key, index) =>
          key === "__proto__" || (key === "prototype" && path[index - 1] === "constructor"),
        )) {
          parser.dispose();
          throw new SyntaxError("Streamfold: unsafe key in tool input");
        }
      }
      return update.partialValue;
    },
    dispose: () => parser.dispose(),
  };
};
