import { wasmBinaryBase64 } from "./wasm-binary.js";

const DEPTH_MASK = 0x00ff_ffff;
const COMPLETE_FLAG = 1 << 24;
const IN_STRING_FLAG = 1 << 25;
const ERROR_SHIFT = 28;

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

export const createWasmParser = () => {
  const wasm = getExports();
  const handle = wasm.streamfold_parser_new();
  if (handle === 0) throw new Error("Unable to allocate the Rust parser");
  return { wasm, handle };
};

export const pushWasmParser = ({ wasm, handle }, chunk) => {
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
  return readState(
    wasm,
    handle,
    wasm.streamfold_parser_push(handle, length),
  );
};

export const finishWasmParser = ({ wasm, handle }) =>
  readState(wasm, handle, wasm.streamfold_parser_finish(handle));

export const readWasmParser = ({ wasm, handle }) =>
  readState(wasm, handle, wasm.streamfold_parser_state(handle));

export const freeWasmParser = ({ wasm, handle }) => {
  wasm.streamfold_parser_free(handle);
};
