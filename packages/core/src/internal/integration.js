import {
  annotateError,
  isStructuredStreamError,
  streamError,
} from "./errors.js";
import { emitDiagnostic } from "./diagnostics.js";

export const createIntegration = (
  pool,
  accept,
  finishActive,
  adapter,
  options = {},
) => {
  const completed = [];
  let failure;
  let batch;
  let eventType;
  let receivedEvents = false;
  let matched = false;
  let reportedNoMatch = false;

  const diagnose = (diagnostic) =>
    emitDiagnostic(options, { adapter, eventType, ...diagnostic });
  const unmatched = (message, id) =>
    diagnose({
      code: "UNMATCHED_TOOL_EVENT",
      message,
      id,
    });
  const record = (type, result) => {
    matched = true;
    if (batch !== undefined) batch.push({ type, ...result });
    return result;
  };
  const missingId = (id) => {
    if (id !== undefined && id !== null) return false;
    unmatched("Tool event is missing its call id");
    return true;
  };

  const complete = (id) => {
    if (missingId(id)) return undefined;
    if (!pool.has(id)) {
      if (
        options.onDiagnostic &&
        !completed.some((result) => result.id === id)
      ) {
        unmatched("Tool completion has no matching active call", id);
      }
      return undefined;
    }
    const result = pool.finish(id);
    completed.push(result);
    return record("complete", result);
  };
  const operations = {
    start: (id, initialChunk) =>
      missingId(id) ? undefined : record("start", pool.start(id, initialChunk)),
    push: (id, delta) =>
      missingId(id) ? undefined : record("update", pool.push(id, delta)),
    has: (id) => pool.has(id),
    complete,
    unmatched,
  };

  const fail = (error) => {
    const original =
      error instanceof Error ? error : new Error("Integration failed");
    failure = isStructuredStreamError(original)
      ? annotateError(original, { adapter, eventType })
      : streamError(original, "INTEGRATION_ERROR", { adapter, eventType });
    for (const id of pool.activeIds) pool.abort(id);
    diagnose({
      code: "STREAM_ERROR",
      message: failure.message,
      error: failure,
      id: failure.id,
    });
    return failure;
  };

  const push = (event, collect) => {
    if (failure !== undefined) throw failure;
    receivedEvents = true;
    batch = collect ? [] : undefined;
    try {
      const type = event?.type ?? event?.event_type;
      eventType =
        typeof type === "string"
          ? type
          : event?.tool_call_chunks
            ? "tool_call_chunks"
            : undefined;
      const update = accept(event, operations);
      return collect ? batch : update;
    } catch (error) {
      throw fail(error);
    } finally {
      batch = undefined;
      eventType = undefined;
    }
  };

  return {
    push: (event) => push(event, false),
    pushAll: (event) => push(event, true),
    finish() {
      if (failure !== undefined) throw failure;
      try {
        finishActive?.(complete);
        for (const id of pool.activeIds) complete(id);
        if (receivedEvents && !matched && !reportedNoMatch) {
          reportedNoMatch = true;
          diagnose({
            code: "NO_TOOL_EVENTS",
            message:
              "No tool argument events matched this adapter; text-only streams are valid, otherwise check the event format",
          });
        }
        return [...completed];
      } catch (error) {
        throw fail(error);
      }
    },
  };
};

export const append = (operations, id, delta) => {
  if (!operations.has(id) && operations.start(id) === undefined)
    return undefined;
  return operations.push(id, delta);
};
