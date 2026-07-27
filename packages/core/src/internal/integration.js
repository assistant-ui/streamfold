export const createIntegration = (pool, accept, finishActive) => {
  const completed = [];

  const complete = (id) => {
    if (!pool.has(id)) return undefined;
    const result = pool.finish(id);
    completed.push(result);
    return result;
  };

  return {
    push(event) {
      return accept(event, complete);
    },
    finish() {
      finishActive?.(complete);
      for (const id of pool.activeIds) complete(id);
      return [...completed];
    },
  };
};

export const append = (pool, id, delta) => {
  if (!pool.has(id)) pool.start(id);
  return pool.push(id, delta);
};
