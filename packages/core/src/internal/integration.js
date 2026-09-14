export const createIntegration = (pool, accept, finishActive) => {
  const completed = [];
  let failure;
  let batch;

  const record = (type, result) => {
    if (batch !== undefined) batch.push({ type, ...result });
    return result;
  };
  const complete = (id) => {
    if (!pool.has(id)) return undefined;
    const result = pool.finish(id);
    completed.push(result);
    return record("complete", result);
  };
  const operations = {
    start: (id, initialChunk) => record("start", pool.start(id, initialChunk)),
    push: (id, delta) => record("update", pool.push(id, delta)),
    has: (id) => pool.has(id),
    complete,
  };

  const fail = (error) => {
    failure = error instanceof Error ? error : new Error("Integration failed");
    for (const id of pool.activeIds) pool.abort(id);
    return failure;
  };
  const push = (event, collect) => {
    if (failure !== undefined) throw failure;
    batch = collect ? [] : undefined;
    try {
      const update = accept(event, operations);
      return collect ? batch : update;
    } catch (error) {
      throw fail(error);
    } finally {
      batch = undefined;
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
        return [...completed];
      } catch (error) {
        throw fail(error);
      }
    },
  };
};

export const append = (operations, id, delta) => {
  if (!operations.has(id)) operations.start(id);
  return operations.push(id, delta);
};
