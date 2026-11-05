const setOwn = (target, key, value, exists) => {
  if (exists) {
    target[key] = value;
    return;
  }
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};

export const applyImmutableChanges = (previous, changes) => {
  if (changes.length === 0) return previous;
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
    for (let index = 0; index < change.path.length - 1; index++) {
      const key = change.path[index];
      const exists = Object.hasOwn(target, key);
      const current = exists ? target[key] : undefined;
      const child = copy(current);
      if (child !== current) setOwn(target, key, child, exists);
      target = child;
    }
    const key = change.path.at(-1);
    const exists = Object.hasOwn(target, key);
    setOwn(target, key, replacement(exists ? target[key] : undefined), exists);
  }
  for (const value of owned) Object.freeze(value);
  return next;
};
