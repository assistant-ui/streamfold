export function abortableSource(events, signal, onAbort) {
  const reader = typeof events?.getReader === "function" ? events.getReader() : undefined;
  const asyncFactory = reader === undefined ? events[Symbol.asyncIterator] : undefined;
  const synchronous = reader === undefined && asyncFactory == null;
  const iterator = reader === undefined
    ? (asyncFactory ?? events[Symbol.iterator]).call(events)
    : undefined;
  const nextMethod = reader === undefined ? iterator.next : undefined;
  const read = async () => {
    signal?.throwIfAborted();
    let next = reader !== undefined ? reader.read() : Reflect.apply(nextMethod, iterator, []);
    if (!synchronous) next = await next;
    if (next === null || (typeof next !== "object" && typeof next !== "function")) {
      throw new TypeError("Iterator `next()` must return an object; return `{ done, value }` for each read.");
    }
    const done = Boolean(next.done);
    return { done, value: synchronous ? await next.value : done ? undefined : next.value };
  };
  const scheduled = signal === undefined ? undefined : Promise.resolve();
  const pull = signal === undefined ? read : () => scheduled.then(read);
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
        const finish = iterator.return;
        if (finish == null) return;
        let result = Reflect.apply(finish, iterator, []);
        if (!synchronous) result = await result;
        if (result === null || (typeof result !== "object" && typeof result !== "function")) {
          throw new TypeError("Iterator `return()` must return an object; return `{ done: true }` after cleanup.");
        }
        if (synchronous) {
          // Native async-from-sync cleanup reads done before unwrapping value.
          void result.done;
          await result.value;
        }
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
