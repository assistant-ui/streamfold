import { wasmBinaryBase64 } from "./wasm-binary.js";

const DEPTH_MASK = 0x00ff_ffff;
const COMPLETE_FLAG = 1 << 24;
const IN_STRING_FLAG = 1 << 25;
const ERROR_SHIFT = 28;
const PATCH_SET_OBJECT = 0;
const PATCH_SET_ARRAY = 1;
const PATCH_SET_STRING = 2;
const PATCH_APPEND_STRING = 3;
const PATCH_SET_NUMBER = 4;
const PATCH_SET_TRUE = 5;
const PATCH_SET_FALSE = 6;
const PATCH_SET_NULL = 7;

const encoder = new TextEncoder();
let exports;

const decodeBase64 = (base64) => {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const getExports = () => {
  if (exports !== undefined) return exports;
  if (typeof WebAssembly !== "object") {
    throw new Error("Streamfold requires WebAssembly support");
  }
  const module = new WebAssembly.Module(decodeBase64(wasmBinaryBase64));
  exports = new WebAssembly.Instance(module, {}).exports;
  return exports;
};

const syntaxError = (wasm, handle, code) => {
  const offset = wasm.streamfold_parser_error_offset(handle) >>> 0;
  const byte = wasm.streamfold_parser_error_byte(handle);
  if (code === 1) {
    const kind = byte === 44 || byte === 58 ? "separator" : "closing";
    return new SyntaxError(`Unexpected ${kind} at ${offset}`);
  }
  if (code === 2) return new SyntaxError(`Mismatched closing at ${offset}`);
  if (code === 3) return new SyntaxError(`Trailing data at ${offset}`);
  if (code === 4) return new SyntaxError("Empty JSON input");
  if (code === 5) return new SyntaxError(`Incomplete JSON at ${offset}`);
  if (code === 6) return new SyntaxError(`Invalid JSON at ${offset}`);
  return new SyntaxError(`Rust parser failed with error code ${code}`);
};

const readState = (wasm, handle, encoded) => {
  const error = encoded >>> ERROR_SHIFT;
  if (error !== 0) throw syntaxError(wasm, handle, error);
  return {
    bytesSeen: wasm.streamfold_parser_bytes_seen(handle) >>> 0,
    depth: encoded & DEPTH_MASK,
    complete: (encoded & COMPLETE_FLAG) !== 0,
    inString: (encoded & IN_STRING_FLAG) !== 0,
  };
};

const readString = (view, cursor, length) => {
  let value = "";
  const batch = [];
  for (let index = 0; index < length; index++) {
    batch.push(view.getUint16(cursor.offset, true));
    cursor.offset += 2;
    if (batch.length === 4096) {
      value += String.fromCharCode(...batch);
      batch.length = 0;
    }
  }
  if (batch.length > 0) value += String.fromCharCode(...batch);
  return value;
};

const readPath = (view, cursor) => {
  const length = view.getUint16(cursor.offset, true);
  cursor.offset += 2;
  const path = [];
  for (let index = 0; index < length; index++) {
    const kind = view.getUint8(cursor.offset++);
    if (kind === 0) {
      const units = view.getUint32(cursor.offset, true);
      cursor.offset += 4;
      path.push(readString(view, cursor, units));
    } else {
      path.push(view.getUint32(cursor.offset, true));
      cursor.offset += 4;
    }
  }
  return path;
};

const readNumber = (view, cursor) => {
  const length = view.getUint32(cursor.offset, true);
  cursor.offset += 4;
  let text = "";
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(view.getUint8(cursor.offset++));
  }
  return Number(text);
};

const readPatches = (wasm, handle) => {
  const length = wasm.streamfold_parser_output_len(handle) >>> 0;
  if (length === 0) return [];
  const pointer = wasm.streamfold_parser_output(handle) >>> 0;
  const view = new DataView(wasm.memory.buffer, pointer, length);
  const cursor = { offset: 0 };
  const patches = [];

  while (cursor.offset < length) {
    const operation = view.getUint8(cursor.offset++);
    const path = readPath(view, cursor);
    if (operation === PATCH_SET_OBJECT) {
      patches.push({ op: "set", path, value: {} });
    } else if (operation === PATCH_SET_ARRAY) {
      patches.push({ op: "set", path, value: [] });
    } else if (operation === PATCH_SET_STRING) {
      patches.push({ op: "set", path, value: "" });
    } else if (operation === PATCH_APPEND_STRING) {
      const units = view.getUint32(cursor.offset, true);
      cursor.offset += 4;
      patches.push({
        op: "append",
        path,
        value: readString(view, cursor, units),
      });
    } else if (operation === PATCH_SET_NUMBER) {
      patches.push({ op: "set", path, value: readNumber(view, cursor) });
    } else if (operation === PATCH_SET_TRUE) {
      patches.push({ op: "set", path, value: true });
    } else if (operation === PATCH_SET_FALSE) {
      patches.push({ op: "set", path, value: false });
    } else if (operation === PATCH_SET_NULL) {
      patches.push({ op: "set", path, value: null });
    } else {
      throw new Error(`Unknown Rust patch operation: ${operation}`);
    }
  }

  return patches;
};

export const createWasmParser = () => {
  const wasm = getExports();
  const handle = wasm.streamfold_parser_new();
  if (handle === 0) throw new Error("Unable to allocate the Rust parser");
  return { wasm, handle, pendingHighSurrogate: "" };
};

const pushChunk = ({ wasm, handle }, chunk) => {
  const capacity = chunk.length * 3;
  const pointer = wasm.streamfold_parser_input(handle, capacity);
  let length = 0;
  if (capacity > 0) {
    const input = new Uint8Array(wasm.memory.buffer, pointer, capacity);
    const result = encoder.encodeInto(chunk, input);
    if (result.read !== chunk.length) {
      throw new Error("Unable to encode the complete stream fragment");
    }
    length = result.written;
  }
  const state = readState(
    wasm,
    handle,
    wasm.streamfold_parser_push(handle, length),
  );
  return { state, changes: readPatches(wasm, handle) };
};

export const pushWasmParser = (parser, chunk) => {
  let input = parser.pendingHighSurrogate + chunk;
  parser.pendingHighSurrogate = "";

  if (input.length > 0) {
    const lastUnit = input.charCodeAt(input.length - 1);
    if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
      parser.pendingHighSurrogate = input.at(-1);
      input = input.slice(0, -1);
    }
  }

  return pushChunk(parser, input);
};

export const finishWasmParser = (parser) => {
  const { wasm, handle } = parser;
  const changes = [];
  if (parser.pendingHighSurrogate.length > 0) {
    changes.push(...pushChunk(parser, parser.pendingHighSurrogate).changes);
    parser.pendingHighSurrogate = "";
  }
  const state = readState(
    wasm,
    handle,
    wasm.streamfold_parser_finish(handle),
  );
  changes.push(...readPatches(wasm, handle));
  return { state, changes };
};

export const readWasmParser = ({ wasm, handle }) =>
  readState(wasm, handle, wasm.streamfold_parser_state(handle));

export const freeWasmParser = ({ wasm, handle }) => {
  wasm.streamfold_parser_free(handle);
};
