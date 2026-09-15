import { createStructuredStreamPool } from "./index.js";
import { streamError } from "./internal/errors.js";
import { abortableSource } from "./internal/abortable-source.js";

export async function* readStructured(
  events,
  { adapter, integration, limits, onDiagnostic, signal },
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
  let source;
  let failed = false;
  const dispose = () => {
    if (pool === undefined) stream?.dispose();
    else for (const id of pool.activeIds) pool.abort(id);
  };
  try {
    signal?.throwIfAborted();
    if (integration !== undefined) {
      pool = createStructuredStreamPool(limits);
      stream = integration(pool, { onDiagnostic });
    } else {
      stream = adapter(
        onDiagnostic === undefined ? limits : { ...limits, onDiagnostic },
      );
    }
    signal?.throwIfAborted();
    // Own the source even without cancellation so a rejected next()
    // still triggers upstream cleanup.
    source = abortableSource(events, signal, dispose);
    for await (const event of source) {
      signal?.throwIfAborted();
      for (const update of stream.pushAll(event)) {
        signal?.throwIfAborted();
        yield update;
      }
    }
    signal?.throwIfAborted();
    if (pool === undefined) {
      for (const completed of stream.finish()) {
        signal?.throwIfAborted();
        yield completed;
      }
    } else {
      // SDK finish() appends pending calls to its legacy completion history.
      const pending = pool.size;
      const completed = stream.finish();
      if (pending > 0) {
        for (const result of completed.slice(-pending)) {
          signal?.throwIfAborted();
          yield { type: "complete", ...result };
        }
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try { dispose(); }
    catch (error) { if (!failed) throw error; }
    finally {
      try { await source?.dispose(); }
      catch (error) { if (!failed) throw error; }
    }
  }
}
