const isUnsafeKey = (key, parentKey) =>
  key === "__proto__" || (key === "prototype" && parentKey === "constructor");

// A whole-document push arrives as one root `set`, so its keys are in the value
// rather than in any patch path. Both are checked.
export const hasUnsafeKey = ({ path, value }) => {
  for (let index = 0; index < path.length; index++) {
    if (isUnsafeKey(path[index], path[index - 1])) return true;
  }
  if (value === null || typeof value !== "object") return false;
  const pending = [value, path.at(-1)];
  while (pending.length > 0) {
    const parentKey = pending.pop();
    const container = pending.pop();
    if (Array.isArray(container)) {
      for (let index = 0; index < container.length; index++) {
        const child = container[index];
        if (child !== null && typeof child === "object") pending.push(child, index);
      }
      continue;
    }
    for (const key of Object.keys(container)) {
      if (isUnsafeKey(key, parentKey)) return true;
      const child = container[key];
      if (child !== null && typeof child === "object") pending.push(child, key);
    }
  }
  return false;
};
