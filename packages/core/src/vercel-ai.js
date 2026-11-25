import { createStructuredStream, createStructuredStreamPool } from "./index.js";
import { annotateError } from "./internal/errors.js";
import { hasUnsafeKey } from "./internal/unsafe-keys.js";
import { assertOptionsObject } from "./internal/options.js";
import { createEmptyArguments, createIntegration } from "./internal/integration.js";

export const vercelAI = (pool = createStructuredStreamPool(), options) => {
  let inStep = false;
  const emptyArguments = createEmptyArguments();
  const completePending = (complete, ending) => {
    emptyArguments.assertClosed(
      pool,
      (id) =>
        ending === undefined
          ? `Vercel AI stream ended before tool call ${id} received tool-input-end, tool-call, or tool-input-available; consume the complete SDK stream or abort it.`
          : `Vercel AI ${ending.type}${typeof ending.finishReason === "string" ? ` (${ending.finishReason})` : ""} arrived before tool call ${id} received tool-input-end, tool-call, or tool-input-available; the step ended before the call closed, so retry the request.`,
      ending,
    );
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
          completePending(calls.complete, event);
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
      if (event.type === "tool-input-end") {
        if (!inStep) return calls.complete(id, emptyArguments.finalChunk(id));
        emptyArguments.close(id);
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

export const createToolInputParser = (options) => {
  assertOptionsObject(options);
  const parser = createStructuredStream({ ...options, snapshots: "immutable" });
  return {
    push(delta) {
      const update = parser.push(delta);
      if (update.changes.some(hasUnsafeKey)) {
        parser.dispose();
        throw new SyntaxError("Streamfold: unsafe key in tool input");
      }
      return update.partialValue;
    },
    dispose: () => parser.dispose(),
  };
};
