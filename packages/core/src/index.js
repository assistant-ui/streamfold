import {
  createWasmParser,
  finishWasmParser,
  freeWasmParser,
  pushWasmParser,
  readWasmParser,
} from "./internal/wasm-runtime.js";

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

  constructor(options = {}) {
    const limits = normalizeStreamLimits(options);
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
      throw this.#fail(error);
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
      throw this.#fail(error);
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
    return isFieldComplete(this.#completion, path)
      ? "complete"
      : "partial";
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
      throw new Error("Structured stream has been disposed");
    }
    return this.#parser;
  }

  #fail(error) {
    const failure =
      error instanceof Error ? error : new Error("Structured stream failed");
    if (this.#parser !== undefined) {
      parserFinalizer?.unregister(this);
      freeWasmParser(this.#parser);
      this.#parser = undefined;
    }
    this.#error = failure;
    return failure;
  }

  #apply(changes) {
    for (const change of changes) {
      if (change.op === "complete") {
        markFieldComplete(this.#completion, change.path);
      } else if (change.op === "set") {
        invalidateField(this.#completion, change.path);
        const value = Array.isArray(change.value)
          ? []
          : change.value !== null && typeof change.value === "object"
            ? {}
            : change.value;
        this.#value = setAtPath(this.#value, change.path, value);
      } else {
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
    throw new TypeError(
      "A Streamfold argument must be an integration or options object",
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
    };
  }

  start(id, initialChunk = "") {
    if (this.#streams.has(id)) {
      throw new Error(`Structured stream already exists: ${String(id)}`);
    }
    if (this.#streams.size >= this.#maxActiveStreams) {
      throw new RangeError(
        `Structured stream pool exceeds maxActiveStreams (${this.#maxActiveStreams})`,
      );
    }

    const entry = {
      scanner: createStructuredStream(this.#streamOptions),
      chunks: [],
    };
    this.#streams.set(id, entry);
    if (initialChunk.length > 0) return this.push(id, initialChunk);
    return { id, ...entry.scanner.state };
  }

  push(id, delta) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw new Error(`Unknown structured stream: ${String(id)}`);
    }
    entry.chunks.push(delta);
    try {
      return { id, ...entry.scanner.push(delta) };
    } catch (error) {
      this.abort(id);
      throw error;
    }
  }

  finish(id) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw new Error(`Unknown structured stream: ${String(id)}`);
    }

    try {
      const state = entry.scanner.finish();
      const text = entry.chunks.join("");
      const value = JSON.parse(text);
      return { id, text, value, ...state };
    } finally {
      this.#streams.delete(id);
      entry.scanner.dispose();
    }
  }

  getFieldState(id, path) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw new Error(`Unknown structured stream: ${String(id)}`);
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
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > 0xffff_ffff
  ) {
    throw new RangeError(`${name} must be an integer between 1 and 4294967295`);
  }
  return limit;
};

const normalizeStreamLimits = (options) => ({
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

const normalizePoolLimits = (options) => ({
  ...normalizeStreamLimits(options),
  maxActiveStreams: normalizeLimit(
    options.maxActiveStreams,
    DEFAULT_STREAM_LIMITS.maxActiveStreams,
    "maxActiveStreams",
  ),
});
