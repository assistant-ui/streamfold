export function abortableSource(events, signal, onAbort) {
  const reader = typeof events?.getReader === "function" ? events.getReader() : undefined;
  const asyncFactory = reader === undefined ? events[Symbol.asyncIterator] : undefined;
  const synchronous = reader === undefined && asyncFactory == null;
  const iterator = reader === undefined
    ? (asyncFactory ?? events[Symbol.iterator]).call(events)
    : undefined;
  const read = async () => {
    signal?.throwIfAborted();
    const next = reader !== undefined ? await reader.read() : await iterator.next();
    if (next === null || typeof next !== "object") {
      throw new TypeError("Iterator result must be an object");
    }
    return synchronous ? { done: next.done, value: await next.value } : next;
  };
  const pull = signal === undefined ? read : () => Promise.resolve().then(read);
  let closed = false;
  // Managed consumption serializes reads and cleanup, so only one wait is active.
  let rejectPending;
  const waitFor = (promise) => signal === undefined ? Promise.resolve(promise) : new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    rejectPending = stop;
    const detach = () => { if (rejectPending === stop) rejectPending = undefined; };
    Promise.resolve(promise).then(
      (value) => {
        detach();
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error) => { detach(); reject(signal.aborted ? signal.reason : error); },
    );
    if (signal.aborted) { detach(); stop(); }
  });

  const close = (reason) => {
    if (closed) return Promise.resolve();
    closed = true;
    return Promise.resolve().then(async () => {
      if (reader !== undefined) {
        try { return reader.cancel(reason); }
        finally { reader.releaseLock(); }
      } else {
        const result = await iterator.return?.();
        if (synchronous && result !== undefined) await result.value;
      }
    });
  };
  const abort = () => {
    try { onAbort(); } catch { /* Cancellation preserves the signal's reason. */ }
    close(signal.reason).catch(() => {});
    const stop = rejectPending;
    rejectPending = undefined;
    stop?.();
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  return {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      signal?.throwIfAborted();
      const result = await waitFor(pull());
      signal?.throwIfAborted();
      if (result.done) {
        closed = true;
        reader?.releaseLock();
      }
      return result;
    },
    async return() {
      const cleanup = close();
      cleanup.catch(() => {});
      if (!signal?.aborted) await waitFor(cleanup);
      return { done: true, value: undefined };
    },
    async dispose() {
      try { await this.return(); }
      finally { signal?.removeEventListener("abort", abort); }
    },
  };
}
