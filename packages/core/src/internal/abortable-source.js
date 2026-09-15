export function abortableSource(events, signal, onAbort) {
  const reader = typeof events?.getReader === "function" ? events.getReader() : undefined;
  const asyncFactory = reader === undefined ? events[Symbol.asyncIterator] : undefined;
  const synchronous = reader === undefined && asyncFactory == null;
  const iterator = reader === undefined
    ? (asyncFactory ?? events[Symbol.iterator]).call(events)
    : undefined;
  let closed = false;
  // Each read removes its listener; one shared pending promise would retain
  // a Promise.race reaction for every event until the session ends.
  const waitFor = (promise) => signal === undefined ? Promise.resolve(promise) : new Promise((resolve, reject) => {
    let listening = true;
    const detach = () => {
      if (!listening) return;
      listening = false;
      signal.removeEventListener("abort", stop);
    };
    const stop = () => { detach(); reject(signal.reason); };
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        detach();
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error) => { detach(); reject(signal.aborted ? signal.reason : error); },
    );
    if (signal.aborted) stop();
  });

  const close = (reason) => {
    if (closed) return Promise.resolve();
    closed = true;
    return Promise.resolve().then(async () => {
      if (reader !== undefined) {
        try { return reader.cancel(reason); }
        finally { reader.releaseLock(); }
      } else {
        await iterator.return?.();
      }
    });
  };
  const abort = () => {
    try { onAbort(); } catch { /* Cancellation preserves the signal's reason. */ }
    close(signal.reason).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  return {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      signal?.throwIfAborted();
      const result = await waitFor(
        Promise.resolve().then(async () => {
          signal?.throwIfAborted();
          const next = reader !== undefined ? await reader.read() : await iterator.next();
          if (next === null || typeof next !== "object") {
            throw new TypeError("Iterator result must be an object");
          }
          return synchronous ? { done: next.done, value: await next.value } : next;
        }),
      );
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
