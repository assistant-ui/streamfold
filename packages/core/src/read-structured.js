import { createStructuredStreamPool } from "./index.js";
import { streamError } from "./internal/errors.js";

export async function* readStructured(
  events,
  { adapter, integration, limits, onDiagnostic },
) {
  if (
    (adapter === undefined) === (integration === undefined) ||
    (adapter !== undefined && typeof adapter !== "function") ||
    (integration !== undefined && typeof integration !== "function")
  ) {
    throw streamError(
      new TypeError("Choose exactly one adapter or integration factory"),
      "INVALID_OPTIONS",
    );
  }
  let pool;
  let stream;
  try {
    if (integration !== undefined) {
      pool = createStructuredStreamPool(limits);
      stream = integration(pool, { onDiagnostic });
    } else {
      stream = adapter(
        onDiagnostic === undefined ? limits : { ...limits, onDiagnostic },
      );
    }
    for await (const event of events) {
      for (const update of stream.pushAll(event)) yield update;
    }
    if (pool === undefined) {
      for (const completed of stream.finish()) yield completed;
    } else {
      // SDK finish() appends pending calls to its legacy completion history.
      const pending = pool.size;
      const completed = stream.finish();
      if (pending > 0) {
        for (const result of completed.slice(-pending)) {
          yield { type: "complete", ...result };
        }
      }
    }
  } finally {
    if (pool === undefined) stream?.dispose();
    else for (const id of pool.activeIds) pool.abort(id);
  }
}
