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

// Copies a JSON value so a patch's value is never shared with a snapshot. It
// walks with an explicit stack because `maxDepth` may exceed the call stack.
export const cloneJsonValue = (value, onContainer) => {
  if (value === null || typeof value !== "object") return value;
  const empty = (source) => (Array.isArray(source) ? [] : {});
  const root = empty(value);
  const pending = [value, root];
  while (pending.length > 0) {
    const target = pending.pop();
    const source = pending.pop();
    onContainer?.(target);
    const keys = Array.isArray(source) ? undefined : Object.keys(source);
    const length = keys === undefined ? source.length : keys.length;
    for (let index = 0; index < length; index++) {
      const key = keys === undefined ? index : keys[index];
      let child = source[key];
      if (child !== null && typeof child === "object") {
        const copy = empty(child);
        pending.push(child, copy);
        child = copy;
      }
      setOwn(target, key, child, key !== "__proto__");
    }
  }
  return root;
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
        ? cloneJsonValue(change.value, (value) => owned.add(value))
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
