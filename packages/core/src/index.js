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

  constructor() {
    parserFinalizer?.register(this, this.#parser, this);
  }

  push(chunk) {
    return pushWasmParser(this.#getParser(), chunk);
  }

  finish() {
    return finishWasmParser(this.#getParser());
  }

  get state() {
    return readWasmParser(this.#getParser());
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
    if (initialChunk.length > 0) this.push(id, initialChunk);
    return entry.scanner.state;
  }

  push(id, delta) {
    const entry = this.#streams.get(id);
    if (entry === undefined) {
      throw new Error(`Unknown structured stream: ${String(id)}`);
    }
    entry.chunks.push(delta);
    return entry.scanner.push(delta);
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
