export const createIntegration = (pool, accept, finishActive) => {
  const completed = [];
  let failure;

  const complete = (id) => {
    if (!pool.has(id)) return undefined;
    const result = pool.finish(id);
    completed.push(result);
    return result;
  };

  const fail = (error) => {
    failure = error instanceof Error ? error : new Error("Integration failed");
    for (const id of pool.activeIds) pool.abort(id);
    return failure;
  };

  return {
    push(event) {
      if (failure !== undefined) throw failure;
      try {
        return accept(event, complete);
      } catch (error) {
        throw fail(error);
      }
    },
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

export const append = (pool, id, delta) => {
  if (!pool.has(id)) pool.start(id);
  return pool.push(id, delta);
};
