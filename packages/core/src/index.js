import {
  createWasmParser,
  finishWasmParser,
  freeWasmParser,
  pushWasmParser,
  readWasmParser,
} from "./internal/wasm-runtime.js";

export const STREAMFOLD_ENGINE = "rust-wasm";

const parserFinalizer =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry(freeWasmParser)
    : undefined;

export class IncrementalJsonScanner {
  #parser = createWasmParser();
  #value;

  constructor() {
    parserFinalizer?.register(this, this.#parser, this);
  }

  push(chunk) {
    const update = pushWasmParser(this.#getParser(), chunk);
    this.#apply(update.changes);
    return {
      ...update.state,
      changes: update.changes,
      partialValue: this.#value,
    };
  }

  finish() {
    const update = finishWasmParser(this.#getParser());
    this.#apply(update.changes);
    return {
      ...update.state,
      changes: update.changes,
      partialValue: this.#value,
    };
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

  get backend() {
    return STREAMFOLD_ENGINE;
  }

  dispose() {
    if (this.#parser === undefined) return;
    parserFinalizer?.unregister(this);
    freeWasmParser(this.#parser);
    this.#parser = undefined;
  }

  #getParser() {
    if (this.#parser === undefined) {
      throw new Error("Structured stream has been disposed");
    }
    return this.#parser;
  }

  #apply(changes) {
    for (const change of changes) {
      if (change.op === "set") {
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

export const createStructuredStream = (integration) => {
  if (integration === undefined) return new IncrementalJsonScanner();
  if (typeof integration !== "function") {
    throw new TypeError("A Streamfold integration must be a function");
  }
  return integration();
};

export class StructuredStreamPool {
  #streams = new Map();

  start(id, initialChunk = "") {
    if (this.#streams.has(id)) {
      throw new Error(`Structured stream already exists: ${String(id)}`);
    }

    const entry = {
      scanner: createStructuredStream(),
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
    return { id, ...entry.scanner.push(delta) };
  }

  finish(id) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw new Error(`Unknown structured stream: ${String(id)}`);
    }

    const state = entry.scanner.finish();
    const text = entry.chunks.join("");
    const value = JSON.parse(text);
    this.#streams.delete(id);
    entry.scanner.dispose();
    return { id, text, value, ...state };
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

export const createStructuredStreamPool = () => new StructuredStreamPool();

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
