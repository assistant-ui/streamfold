import {
  createWasmParser,
  finishWasmParser,
  freeWasmParser,
  pushWasmParser,
  readWasmParser,
} from "./internal/wasm-runtime.js";
import { applyImmutableChanges, freezeJson } from "./internal/snapshots.js";
import { annotateError, streamError } from "./internal/errors.js";

export { isStructuredStreamError } from "./internal/errors.js";

export const STREAMFOLD_ENGINE = "rust-wasm";
export const DEFAULT_STREAM_LIMITS = Object.freeze({
  maxActiveStreams: 256,
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 128,
});

const parserFinalizer =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry(freeWasmParser)
    : undefined;

export class IncrementalJsonScanner {
  #parser;
  #value;
  #completion = createCompletionNode();
  #error;
  #immutable;

  constructor(options = {}) {
    const limits = normalizeStreamLimits(options);
    this.#immutable = limits.snapshots === "immutable";
    this.#parser = createWasmParser(limits);
    parserFinalizer?.register(this, this.#parser, this);
  }

  push(chunk) {
    try {
      const update = pushWasmParser(this.#getParser(), chunk);
      this.#apply(update.changes);
      return {
        ...update.state,
        changes: update.changes,
        partialValue: this.#value,
      };
    } catch (error) {
      throw this.#fail(error, "push");
    }
  }

  finish() {
    try {
      const update = finishWasmParser(this.#getParser());
      this.#apply(update.changes);
      return {
        ...update.state,
        changes: update.changes,
        partialValue: this.#value,
      };
    } catch (error) {
      throw this.#fail(error, "finish");
    }
  }

  get state() {
    return {
      ...readWasmParser(this.#getParser()),
      changes: [],
      partialValue: this.#value,
    };
  }

  get value() {
    return this.#value;
  }

  getFieldState(path) {
    return isFieldComplete(this.#completion, path) ? "complete" : "partial";
  }

  get backend() {
    return STREAMFOLD_ENGINE;
  }

  dispose() {
    if (this.#parser !== undefined) {
      parserFinalizer?.unregister(this);
      freeWasmParser(this.#parser);
      this.#parser = undefined;
    }
    this.#error = undefined;
  }

  #getParser() {
    if (this.#error !== undefined) throw this.#error;
    if (this.#parser === undefined) {
      throw streamError(
        new Error("Structured stream has been disposed"),
        "STREAM_DISPOSED",
      );
    }
    return this.#parser;
  }

  #fail(error, operation) {
    const failure =
      error instanceof Error ? error : new Error("Structured stream failed");
    if (this.#parser !== undefined) {
      parserFinalizer?.unregister(this);
      freeWasmParser(this.#parser);
      this.#parser = undefined;
    }
    this.#error = failure;
    if (failure.operation === undefined) annotateError(failure, { operation });
    return failure;
  }

  #apply(changes) {
    if (this.#immutable)
      this.#value = applyImmutableChanges(this.#value, changes);
    for (const change of changes) {
      if (change.op === "complete") {
        markFieldComplete(this.#completion, change.path);
      } else if (change.op === "set") {
        invalidateField(this.#completion, change.path);
        if (this.#immutable) continue;
        const value = Array.isArray(change.value)
          ? []
          : change.value !== null && typeof change.value === "object"
            ? {}
            : change.value;
        this.#value = setAtPath(this.#value, change.path, value);
      } else if (!this.#immutable) {
        const current = getAtPath(this.#value, change.path);
        this.#value = setAtPath(
          this.#value,
          change.path,
          `${current}${change.value}`,
        );
      }
    }
  }
}

export const createStructuredStream = (integrationOrOptions) => {
  if (
    integrationOrOptions === undefined ||
    (typeof integrationOrOptions === "object" &&
      integrationOrOptions !== null &&
      !Array.isArray(integrationOrOptions))
  ) {
    return new IncrementalJsonScanner(integrationOrOptions);
  }
  if (typeof integrationOrOptions !== "function") {
    throw streamError(
      new TypeError(
        "A Streamfold argument must be an integration or options object",
      ),
      "INVALID_OPTIONS",
    );
  }
  return integrationOrOptions();
};

export class StructuredStreamPool {
  #streams = new Map();
  #maxActiveStreams;
  #streamOptions;

  constructor(options = {}) {
    const limits = normalizePoolLimits(options);
    this.#maxActiveStreams = limits.maxActiveStreams;
    this.#streamOptions = {
      maxBytes: limits.maxBytes,
      maxDepth: limits.maxDepth,
      snapshots: limits.snapshots,
    };
  }

  start(id, initialChunk = "") {
    if (typeof initialChunk !== "string") {
      throw streamError(
        new TypeError("A structured stream chunk must be a string"),
        "INVALID_CHUNK",
        { id, operation: "start" },
      );
    }
    if (this.#streams.has(id)) {
      throw streamError(
        new Error(`Structured stream already exists: ${String(id)}`),
        "DUPLICATE_STREAM",
        { id, operation: "start" },
      );
    }
    if (this.#streams.size >= this.#maxActiveStreams) {
      throw streamError(
        new RangeError(
          `Structured stream pool exceeds maxActiveStreams (${this.#maxActiveStreams})`,
        ),
        "MAX_ACTIVE_STREAMS_EXCEEDED",
        { id, operation: "start" },
      );
    }

    const entry = {
      scanner: createStructuredStream(this.#streamOptions),
      chunks: [],
    };
    this.#streams.set(id, entry);
    if (initialChunk.length > 0) {
      try {
        return this.push(id, initialChunk);
      } catch (error) {
        throw annotateError(error, { operation: "start" });
      }
    }
    return { id, ...entry.scanner.state };
  }

  push(id, delta) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw streamError(
        new Error(
          `Unknown structured stream: ${String(id)} (push requires an active call)`,
        ),
        "UNKNOWN_STREAM",
        { id, operation: "push" },
      );
    }
    entry.chunks.push(delta);
    try {
      return { id, ...entry.scanner.push(delta) };
    } catch (error) {
      this.abort(id);
      throw annotateError(error, { id, operation: "push" });
    }
  }

  finish(id) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw streamError(
        new Error(`Unknown structured stream: ${String(id)}`),
        "UNKNOWN_STREAM",
        { id, operation: "finish" },
      );
    }

    try {
      const state = entry.scanner.finish();
      const text = entry.chunks.join("");
      const value = JSON.parse(text);
      if (this.#streamOptions.snapshots === "immutable") freezeJson(value);
      return { id, text, value, ...state };
    } catch (error) {
      throw annotateError(error, { id, operation: "finish" });
    } finally {
      this.#streams.delete(id);
      entry.scanner.dispose();
    }
  }

  getFieldState(id, path) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw streamError(
        new Error(`Unknown structured stream: ${String(id)}`),
        "UNKNOWN_STREAM",
        { id, operation: "getFieldState" },
      );
    }
    return entry.scanner.getFieldState(path);
  }

  abort(id) {
    const entry = this.#streams.get(id);
    if (entry === undefined) return false;
    this.#streams.delete(id);
    entry.scanner.dispose();
    return true;
  }

  has(id) {
    return this.#streams.has(id);
  }

  get activeIds() {
    return [...this.#streams.keys()];
  }

  get size() {
    return this.#streams.size;
  }
}

export const createStructuredStreamPool = (options) =>
  new StructuredStreamPool(options);

const getAtPath = (root, path) => {
  let current = root;
  for (const segment of path) current = current[segment];
  return current;
};

const setAtPath = (root, path, value) => {
  if (path.length === 0) return value;

  let target = root;
  for (let index = 0; index < path.length - 1; index++) {
    target = target[path[index]];
  }
  Object.defineProperty(target, path.at(-1), {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return root;
};

const createCompletionNode = () => ({ complete: false, children: new Map() });

const markFieldComplete = (root, path) => {
  let node = root;
  for (const segment of path) {
    const key = String(segment);
    let child = node.children.get(key);
    if (child === undefined) {
      child = createCompletionNode();
      node.children.set(key, child);
    }
    node = child;
  }
  node.complete = true;
};

const invalidateField = (root, path) => {
  if (path.length === 0) {
    root.complete = false;
    root.children.clear();
    return;
  }

  let node = root;
  for (let index = 0; index < path.length - 1; index++) {
    node = node.children.get(String(path[index]));
    if (node === undefined) return;
  }
  node.children.delete(String(path.at(-1)));
};

const isFieldComplete = (root, path) => {
  let node = root;
  if (node.complete) return true;
  for (const segment of path) {
    node = node.children.get(String(segment));
    if (node === undefined) return false;
    if (node.complete) return true;
  }
  return false;
};

const normalizeLimit = (value, fallback, name) => {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 0xffff_ffff) {
    throw streamError(
      new RangeError(`${name} must be an integer between 1 and 4294967295`),
      "INVALID_OPTIONS",
    );
  }
  return limit;
};

const normalizeStreamLimits = (options) => ({
  snapshots: normalizeSnapshots(options.snapshots),
  maxBytes: normalizeLimit(
    options.maxBytes,
    DEFAULT_STREAM_LIMITS.maxBytes,
    "maxBytes",
  ),
  maxDepth: normalizeLimit(
    options.maxDepth,
    DEFAULT_STREAM_LIMITS.maxDepth,
    "maxDepth",
  ),
});

const normalizeSnapshots = (snapshots = "live") => {
  if (snapshots !== "live" && snapshots !== "immutable") {
    throw streamError(
      new TypeError('snapshots must be "live" or "immutable"'),
      "INVALID_OPTIONS",
    );
  }
  return snapshots;
};

const normalizePoolLimits = (options) => ({
  ...normalizeStreamLimits(options),
  maxActiveStreams: normalizeLimit(
    options.maxActiveStreams,
    DEFAULT_STREAM_LIMITS.maxActiveStreams,
    "maxActiveStreams",
  ),
});
