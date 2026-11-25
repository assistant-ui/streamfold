import { createStructuredStreamPool } from "./index.js";
import { streamError } from "./internal/errors.js";
import { createIntegration } from "./internal/integration.js";

export const pi = (pool = createStructuredStreamPool(), options) => {
  const ids = new Map();
  const assertClosed = () => {
    for (const [index, id] of ids) {
      throw streamError(
        new Error(
          `Pi stream ended before toolcall_end at contentIndex ${index}; consume the complete SDK stream or abort it.`,
        ),
        "INTEGRATION_ERROR",
        { id },
      );
    }
  };
  return createIntegration(
    pool,
    (event, calls) => {
      const index = event.contentIndex;
      switch (event.type) {
        case "toolcall_start": {
          const block = event.partial.content[index];
          if (block?.type !== "toolCall" || ids.has(index)) {
            throw new Error(`Invalid Pi toolcall_start at contentIndex ${index}`);
          }
          ids.set(index, block.id);
          // Some OpenAI-compatible providers send the ID after the first chunk.
          return block.id ? calls.start(block.id) : undefined;
        }
        case "toolcall_delta": {
          if (!ids.has(index)) calls.unmatched("Pi toolcall_delta has no matching contentIndex");
          const id = ids.get(index);
          return id ? calls.push(id, event.delta) : undefined;
        }
        case "toolcall_end": {
          const { id, argumentsError } = event.toolCall;
          const startedId = ids.get(index);
          if (!id || (startedId && startedId !== id) || (!startedId && calls.has(id))) {
            throw new Error(`Invalid Pi tool call ID at contentIndex ${index}`);
          }
          if (argumentsError !== undefined) {
            throw streamError(
              new Error(argumentsError, { cause: event.toolCall }),
              "INTEGRATION_ERROR",
              { id },
            );
          }
          ids.delete(index);
          return calls.complete(id, () => JSON.stringify(event.toolCall.arguments));
        }
        case "error":
          throw new Error(event.error.errorMessage ?? `Pi stream ${event.reason}`, {
            cause: event,
          });
        case "done":
          if (event.reason === "length") {
            throw new Error("Pi stream reached its length limit", { cause: event });
          }
          assertClosed();
      }
    },
    assertClosed,
    "pi",
    options,
    () => ids.clear(),
  );
};

export { pi as createStructuredStream };
