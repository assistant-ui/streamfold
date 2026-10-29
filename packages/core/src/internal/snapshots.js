const setOwn = (target, key, value) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};

export const applyImmutableChanges = (previous, changes) => {
  const owned = new Set();
  const copy = (value) => {
    if (owned.has(value)) return value;
    const result = Array.isArray(value) ? [...value] : { ...value };
    owned.add(result);
    return result;
  };

  let next = previous;
  for (const change of changes) {
    if (change.op === "complete" || change.op === "invalidate") continue;
    const replacement = (current) => {
      if (change.op === "append") return current + change.value;
      return change.value !== null && typeof change.value === "object"
        ? copy(change.value)
        : change.value;
    };
    if (change.path.length === 0) {
      next = replacement(next);
      continue;
    }

    // Copy each changed container once per batch, even for many array appends.
    next = copy(next);
    let target = next;
    for (const key of change.path.slice(0, -1)) {
      const current = Object.hasOwn(target, key) ? target[key] : undefined;
      const child = copy(current);
      if (child !== current) setOwn(target, key, child);
      target = child;
    }
    const key = change.path.at(-1);
    setOwn(
      target,
      key,
      replacement(Object.hasOwn(target, key) ? target[key] : undefined),
    );
  }
  for (const value of owned) Object.freeze(value);
  return next;
};
