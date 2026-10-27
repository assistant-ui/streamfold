import { createStructuredStreamPool } from "./index.js";
import {
  annotateError,
  isStructuredStreamError,
  streamError,
} from "./internal/errors.js";
import { emitDiagnostic } from "./internal/diagnostics.js";

export function defineAdapter(mapEvent) {
  if (typeof mapEvent !== "function") {
    throw streamError(
      new TypeError("An adapter mapper must be a function"),
      "INVALID_OPTIONS",
    );
  }

  return (options) => {
    const pool = createStructuredStreamPool(options);
    let status = "active";
    let failure;
    let eventType;
    let operationContext;
    let receivedEvents = false;
    let matched = false;

    const diagnose = (diagnostic) =>
      emitDiagnostic(options, { adapter: "custom", eventType, ...diagnostic });
    const disposeActive = () => {
      for (const id of pool.activeIds) pool.abort(id);
    };

    const fail = (error) => {
      const original =
        error instanceof Error
          ? error
          : new Error("Adapter stream failed", { cause: error });
      const context = { adapter: "custom", eventType };
      failure = isStructuredStreamError(original)
        ? annotateError(original, context)
        : streamError(original, "INTEGRATION_ERROR", {
            ...context,
            ...operationContext,
          });
      disposeActive();
      diagnose({
        code: "STREAM_ERROR",
        message: failure.message,
        error: failure,
        id: failure.id,
      });
      return failure;
    };

    const assertActive = () => {
      if (failure !== undefined) throw failure;
      if (status !== "active") {
        throw streamError(
          new Error(`Adapter stream has been ${status}`),
          status === "disposed" ? "STREAM_DISPOSED" : "INTEGRATION_ERROR",
          { adapter: "custom" },
        );
      }
    };

    return {
      pushAll(event) {
        assertActive();
        receivedEvents = true;
        try {
          const type = event?.type ?? event?.event_type ?? event?.kind;
          eventType =
            typeof type === "string"
              ? type
              : Array.isArray(event)
                ? "operations"
                : undefined;
          const operations = mapEvent(event);
          if (!Array.isArray(operations)) {
            throw new TypeError("An adapter mapper must return an array");
          }

          const updates = [];
          for (const operation of operations) {
            operationContext = undefined;
            if (
              operation === null ||
              typeof operation !== "object" ||
              !("id" in operation)
            ) {
              throw new TypeError("An adapter operation must include an id");
            }
            operationContext = { id: operation.id };
            switch (operation.type) {
              case "start":
                operationContext.operation = "start";
                updates.push({ type: "start", ...pool.start(operation.id) });
                break;
              case "delta":
                operationContext.operation = "push";
                if (typeof operation.text !== "string") {
                  throw new TypeError("An adapter delta must include text");
                }
                updates.push({
                  type: "update",
                  ...pool.push(operation.id, operation.text),
                });
                break;
              case "end":
                operationContext.operation = "finish";
                updates.push({
                  type: "complete",
                  ...pool.finish(operation.id),
                });
                break;
              case "abort":
                pool.abort(operation.id);
                break;
              default:
                throw new TypeError("Unknown adapter operation type");
            }
            matched = true;
          }
          return updates;
        } catch (error) {
          throw fail(error);
        } finally {
          eventType = undefined;
          operationContext = undefined;
        }
      },

      finish() {
        if (failure !== undefined) throw failure;
        if (status === "finished") return [];
        assertActive();
        try {
          const completed = pool.activeIds.map((id) => ({
            type: "complete",
            ...pool.finish(id),
          }));
          status = "finished";
          if (receivedEvents && !matched) {
            diagnose({
              code: "NO_TOOL_EVENTS",
              message:
                "No tool operations were mapped; text-only streams are valid, otherwise check the event mapper",
            });
          }
          return completed;
        } catch (error) {
          throw fail(error);
        }
      },

      dispose() {
        disposeActive();
        if (status === "active") status = "disposed";
      },
    };
  };
}
