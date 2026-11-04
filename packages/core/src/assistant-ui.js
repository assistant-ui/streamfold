import { createStructuredStream, createStructuredStreamPool, prepareStreamfold } from "./index.js";
import { createIntegration } from "./internal/integration.js";

const pathKey = (path) => path.join("/");

export const assistantUI = (pool = createStructuredStreamPool(), options) => {
  const idsByPath = new Map();
  let nextPartIndex = 0;

  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "error") {
        throw new Error(event.error ?? "Assistant stream failed", { cause: event });
      }
      if (
        (event.type === "step-finish" || event.type === "message-finish") &&
        event.finishReason === "error"
      ) {
        throw new Error("Assistant generation failed", { cause: event });
      }
      if (event.type === "part-start") {
        // Native starts use the root path; older integrations supply the part path.
        const key = event.path.length === 0
          ? String(nextPartIndex++)
          : pathKey(event.path);
        if (event.part.type === "tool-call") {
          idsByPath.set(key, event.part.toolCallId);
          return calls.start(event.part.toolCallId);
        }
        return undefined;
      }

      const key = pathKey(event.path);
      const id = idsByPath.get(key);
      if (id === undefined) {
        if (event.type === "tool-call-args-text-finish") {
          calls.unmatched("Tool completion has no matching part path");
        }
        return undefined;
      }

      if (event.type === "text-delta") {
        return calls.push(id, event.textDelta);
      }
      if (event.type === "tool-call-args-text-finish") {
        idsByPath.delete(key);
        return calls.complete(id);
      }
      return undefined;
    },
    undefined,
    "assistant-ui",
    options,
  );
};

export { assistantUI as createStructuredStream };

let initialization;

const initialize = async () => {
  if (typeof WebAssembly !== "object" || typeof FinalizationRegistry !== "function") return false;
  try {
    const { registerJsonParserBackend } = await import("assistant-stream");
    if (typeof registerJsonParserBackend !== "function") return false;
    await prepareStreamfold();
    const probe = createStructuredStream({ snapshots: "live" });
    probe.dispose();
    const { createAssistantStreamBackend } = await import("./internal/assistant-stream.js");
    registerJsonParserBackend(createAssistantStreamBackend);
    return true;
  } catch {
    return false;
  }
};

export async function initializeAssistantStream() {
  const pending = (initialization ??= initialize());
  const enabled = await pending;
  if (!enabled && initialization === pending) initialization = undefined;
  return enabled;
}
