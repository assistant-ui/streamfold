import { wasmBinaryBase64 } from "./wasm-binary.js";
import { streamError } from "./errors.js";

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
const PATCH_COMPLETE = 8;
const PATCH_INVALIDATE = 9;

const encoder = new TextEncoder();
const numberDecoder = (() => {
  try {
    return new TextDecoder();
  } catch {
    return undefined;
  }
})();
const utf16Decoder = (() => {
  try {
    return new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true });
  } catch {
    return undefined;
  }
})();
let runtime;
let compiledModule;
let compiling;

const decodeWasmBytes = () => {
  if (typeof Uint8Array.fromBase64 === "function")
    return Uint8Array.fromBase64(wasmBinaryBase64);
  if (typeof globalThis.Buffer?.from === "function")
    return globalThis.Buffer.from(wasmBinaryBase64, "base64");
  const binary = globalThis.atob(wasmBinaryBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

// The embedded bytes are fixed and valid, so a failure to compile them comes
// from the runtime, not the input. Every compile failure is wrapped, not only
// CompileError, so the code does not depend on how an engine reports a refusal.
const compileBlockedError = (error) =>
  streamError(
    new Error(
      `Streamfold could not compile its WebAssembly parser (${error?.message ?? error}). Streamfold compiles Wasm from bytes at runtime, which Cloudflare Workers, Vercel Edge Functions, and pages whose Content-Security-Policy blocks Wasm do not allow. Run it in Node.js instead of an edge isolate, or add 'wasm-unsafe-eval' to the page's script-src.`,
      { cause: error },
    ),
    "WASM_COMPILE_BLOCKED",
  );

const compileWasmSync = () => {
  const bytes = decodeWasmBytes();
  try {
    return new WebAssembly.Module(bytes);
  } catch (error) {
    throw compileBlockedError(error);
  }
};

const getRuntime = () => {
  if (runtime !== undefined) return runtime;
  if (typeof WebAssembly !== "object") {
    throw new Error("Streamfold requires WebAssembly support");
  }
  const module = compiledModule ?? compileWasmSync();
  runtime = {
    wasm: new WebAssembly.Instance(module, {}).exports,
    trap: undefined,
  };
  return runtime;
};

const wasmTrapError = (trap, message) =>
  streamError(new Error(message, { cause: trap }), "WASM_TRAP");

// A trap aborts Rust mid-call, so the instance's linear memory may be
// inconsistent. Every parser on that instance fails closed, and new parsers get
// a fresh instance. Arguments are forwarded rather than captured in a closure,
// because an error's lazily formatted stack would keep that closure, and with it
// the input chunk, alive.
const callWasm = (target, operation, first, second) => {
  if (target.trap !== undefined) {
    throw wasmTrapError(
      target.trap,
      "Streamfold's WebAssembly parser crashed in another stream, so this stream's state is no longer reliable. Start a new stream to retry.",
    );
  }
  try {
    return operation(first, second);
  } catch (error) {
    if (!(error instanceof WebAssembly.RuntimeError)) throw error;
    target.trap = error;
    if (runtime === target) runtime = undefined;
    throw wasmTrapError(
      error,
      `Streamfold's WebAssembly parser crashed (${error.message}). This stream cannot continue; start a new stream to retry, and report the input at https://github.com/assistant-ui/streamfold/issues if it happens again.`,
    );
  }
};

export const prepareWasm = () => {
  if (runtime !== undefined || compiledModule !== undefined)
    return Promise.resolve();
  if (compiling !== undefined) return compiling;
  if (
    typeof WebAssembly !== "object" ||
    typeof WebAssembly.compile !== "function"
  ) {
    return Promise.reject(new Error("Streamfold requires WebAssembly support"));
  }
  try {
    const bytes = decodeWasmBytes();
    // The executor turns a synchronous throw into the same rejection.
    compiling = new Promise((resolve) =>
      resolve(WebAssembly.compile(bytes)),
    ).then(
      (module) => {
        compiledModule = module;
        compiling = undefined;
      },
      (error) => {
        compiling = undefined;
        throw compileBlockedError(error);
      },
    );
  } catch (error) {
    return Promise.reject(error);
  }
  return compiling;
};

const describeParserError = ({ wasm, handle, maxBytes, maxDepth }, code, offset) => {
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
  if (code === 7) {
    return new RangeError(
      `Structured stream exceeds maxBytes (${maxBytes}) at ${offset}`,
    );
  }
  if (code === 8) {
    return new RangeError(
      `Structured stream exceeds maxDepth (${maxDepth}) at ${offset}`,
    );
  }
  return new SyntaxError(`Rust parser failed with error code ${code}`);
};

const parserErrorCodes = [
  "PARSER_ERROR",
  "UNEXPECTED_TOKEN",
  "MISMATCHED_CLOSING",
  "TRAILING_DATA",
  "EMPTY_INPUT",
  "INCOMPLETE_JSON",
  "INVALID_JSON",
  "MAX_BYTES_EXCEEDED",
  "MAX_DEPTH_EXCEEDED",
];

const parserError = (
  parser,
  code,
  byteOffset = parser.wasm.streamfold_parser_error_offset(parser.handle) >>> 0,
) =>
  streamError(
    describeParserError(parser, code, byteOffset),
    parserErrorCodes[code] ?? "PARSER_ERROR",
    { byteOffset },
  );

const readState = (parser, encoded) => {
  const { wasm, handle } = parser;
  const error = encoded >>> ERROR_SHIFT;
  if (error !== 0) throw parserError(parser, error);
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

const readAppendString = (view, cursor, length) => {
  if (length >= 128 && utf16Decoder !== undefined) {
    const first = view.getUint16(cursor.offset, true);
    const last = view.getUint16(cursor.offset + (length - 1) * 2, true);
    if (
      (first >= 0xdc00 && first <= 0xdfff) ||
      (last >= 0xd800 && last <= 0xdbff)
    ) return readString(view, cursor, length);
    try {
      const value = utf16Decoder.decode(new Uint8Array(
        view.buffer, view.byteOffset + cursor.offset, length * 2,
      ));
      cursor.offset += length * 2;
      return value;
    } catch {
      // JSON Unicode escapes may contain lone surrogates, which must stay lossless.
    }
  }
  return readString(view, cursor, length);
};

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const readPathString = (view, cursor, length) => {
  if (!littleEndian) return readString(view, cursor, length);
  let value = "";
  for (let index = 0; index < length; index += 4096) {
    const units = Math.min(length - index, 4096);
    const offset = view.byteOffset + cursor.offset;
    const input = offset % 2 === 0
      ? new Uint16Array(view.buffer, offset, units)
      : new Uint16Array(view.buffer.slice(offset, offset + units * 2));
    value += String.fromCharCode.apply(null, input);
    cursor.offset += units * 2;
  }
  return value;
};

// Each encoded path repeats only the segments after the prefix it shares with
// the previous path, so key strings are decoded once and shared between patches.
// Every patch gets its own copy because callers may mutate `change.path`.
const readPath = (parser, view, cursor, copy = true) => {
  const shared = view.getUint16(cursor.offset, true);
  const length = view.getUint16(cursor.offset + 2, true);
  cursor.offset += 4;
  if (length === 0) return [];
  const path = parser.lastPath;
  while (path.length > shared) path.pop();
  for (let index = shared; index < length; index++) {
    const kind = view.getUint8(cursor.offset++);
    if (kind === 0) {
      const units = view.getUint32(cursor.offset, true);
      cursor.offset += 4;
      path.push(units >= 128
        ? readPathString(view, cursor, units)
        : readString(view, cursor, units));
    } else {
      path.push(view.getUint32(cursor.offset, true));
      cursor.offset += 4;
    }
  }
  return copy ? path.slice() : path;
};

const readNumber = (view, cursor) => {
  const length = view.getUint32(cursor.offset, true);
  cursor.offset += 4;
  if (length >= 128 && numberDecoder !== undefined) {
    const text = numberDecoder.decode(new Uint8Array(
      view.buffer, view.byteOffset + cursor.offset, length,
    ));
    cursor.offset += length;
    return Number(text);
  }
  let text = "";
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(view.getUint8(cursor.offset++));
  }
  return Number(text);
};

const setOwn = (target, key, value) => {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  } else {
    target[key] = value;
  }
};

// A push that opens and closes the root object or array would otherwise yield a
// patch, with its own path array, for every value in the document, so memory
// grew with input size times depth. It is reported as one root `set` with the
// whole value instead. The patches are still read in order, so duplicate keys
// and string appends resolve exactly as the live and immutable appliers would.
const readDocument = (parser, view, cursor, length) => {
  const containers = [];
  while (cursor.offset < length) {
    const operation = view.getUint8(cursor.offset++);
    const path = readPath(parser, view, cursor, false);
    const depth = path.length;
    let value;
    if (operation === PATCH_SET_OBJECT) {
      value = {};
    } else if (operation === PATCH_SET_ARRAY) {
      value = [];
    } else if (operation === PATCH_SET_STRING) {
      value = "";
    } else if (operation === PATCH_APPEND_STRING) {
      const units = view.getUint32(cursor.offset, true);
      cursor.offset += 4;
      const parent = containers[depth - 1];
      const key = path[depth - 1];
      setOwn(parent, key, parent[key] + readAppendString(view, cursor, units));
      continue;
    } else if (operation === PATCH_SET_NUMBER) {
      value = readNumber(view, cursor);
    } else if (operation === PATCH_SET_TRUE) {
      value = true;
    } else if (operation === PATCH_SET_FALSE) {
      value = false;
    } else if (operation === PATCH_SET_NULL) {
      value = null;
    } else if (operation === PATCH_COMPLETE || operation === PATCH_INVALIDATE) {
      continue;
    } else {
      throw new Error(`Unknown Rust patch operation: ${operation}`);
    }
    if (depth === 0) {
      if (containers.length !== 0) throw new Error("Rust parser replaced a complete root");
    } else {
      setOwn(containers[depth - 1], path[depth - 1], value);
    }
    if (typeof value === "object" && value !== null) {
      containers.length = depth;
      containers.push(value);
    }
  }
  return [
    { op: "set", path: [], value: containers[0] },
    { op: "complete", path: [] },
  ];
};

const readPatches = (parser, complete = false) => {
  const { wasm, handle } = parser;
  const length = wasm.streamfold_parser_output_len(handle) >>> 0;
  if (length === 0) return [];
  const pointer = wasm.streamfold_parser_output(handle) >>> 0;
  const view = new DataView(wasm.memory.buffer, pointer, length);
  const cursor = { offset: 0 };
  const first = view.getUint8(0);
  // An empty path is encoded as two zero lengths after the operation byte.
  if (
    complete &&
    (first === PATCH_SET_OBJECT || first === PATCH_SET_ARRAY) &&
    view.getUint16(3, true) === 0
  ) {
    return readDocument(parser, view, cursor, length);
  }
  const patches = [];

  while (cursor.offset < length) {
    const operation = view.getUint8(cursor.offset++);
    const path = readPath(parser, view, cursor);
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
        value: readAppendString(view, cursor, units),
      });
    } else if (operation === PATCH_SET_NUMBER) {
      patches.push({ op: "set", path, value: readNumber(view, cursor) });
    } else if (operation === PATCH_SET_TRUE) {
      patches.push({ op: "set", path, value: true });
    } else if (operation === PATCH_SET_FALSE) {
      patches.push({ op: "set", path, value: false });
    } else if (operation === PATCH_SET_NULL) {
      patches.push({ op: "set", path, value: null });
    } else if (operation === PATCH_COMPLETE) {
      patches.push({ op: "complete", path });
    } else if (operation === PATCH_INVALIDATE) {
      patches.push({ op: "invalidate", path });
    } else {
      throw new Error(`Unknown Rust patch operation: ${operation}`);
    }
  }

  return patches;
};

export const createWasmParser = ({ maxBytes, maxDepth }) => {
  const target = getRuntime();
  const { wasm } = target;
  const handle = callWasm(target, wasm.streamfold_parser_new, maxDepth, maxBytes);
  if (handle === 0) throw new Error("Unable to allocate the Rust parser");
  return {
    runtime: target,
    wasm,
    handle,
    maxBytes,
    maxDepth,
    pendingHighSurrogate: "",
    lastPath: [],
  };
};

const pushChunk = (parser, chunk) => {
  if (chunk.length === 0) return { state: readParser(parser), changes: [] };

  // In Unicode mode this range matches lone surrogate code units, not valid
  // pairs. TextEncoder would silently replace them with U+FFFD, while the
  // pool's final JSON.parse would preserve them, producing different values.
  // A trailing high surrogate is buffered by pushWasmParser before this check.
  if (/[\uD800-\uDFFF]/u.test(chunk)) {
    throw streamError(
      new TypeError("Unpaired UTF-16 surrogate; use a JSON Unicode escape"),
      "INVALID_CHUNK",
    );
  }
  const { wasm, handle } = parser;
  const bytesSeen = wasm.streamfold_parser_bytes_seen(handle) >>> 0;
  const remaining = parser.maxBytes - bytesSeen;
  if (chunk.length > remaining) throw parserError(parser, 7, bytesSeen);
  const capacity = Math.min(chunk.length * 3, remaining);
  const pointer = wasm.streamfold_parser_input(handle, capacity);
  let length = 0;
  if (capacity > 0) {
    const input = new Uint8Array(wasm.memory.buffer, pointer, capacity);
    const result = encoder.encodeInto(chunk, input);
    if (result.read !== chunk.length) {
      throw parserError(parser, 7, bytesSeen);
    }
    length = result.written;
  }
  const state = readState(parser, wasm.streamfold_parser_push(handle, length));
  return { state, changes: readPatches(parser, state.complete) };
};

export const pushWasmParser = (parser, chunk) => {
  if (typeof chunk !== "string") {
    throw streamError(
      new TypeError("A structured stream chunk must be a string"),
      "INVALID_CHUNK",
    );
  }
  let input = parser.pendingHighSurrogate + chunk;
  parser.pendingHighSurrogate = "";

  if (input.length > 0) {
    const lastUnit = input.charCodeAt(input.length - 1);
    if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
      parser.pendingHighSurrogate = input.at(-1);
      input = input.slice(0, -1);
    }
  }

  return callWasm(parser.runtime, pushChunk, parser, input);
};

const finishParser = (parser) => {
  const { wasm, handle } = parser;
  const changes = [];
  if (parser.pendingHighSurrogate.length > 0) {
    changes.push(...pushChunk(parser, parser.pendingHighSurrogate).changes);
    parser.pendingHighSurrogate = "";
  }
  const state = readState(parser, wasm.streamfold_parser_finish(handle));
  changes.push(...readPatches(parser));
  return { state, changes };
};

export const finishWasmParser = (parser) =>
  callWasm(parser.runtime, finishParser, parser);

const readParser = (parser) =>
  readState(parser, parser.wasm.streamfold_parser_state(parser.handle));

export const readWasmParser = (parser) =>
  callWasm(parser.runtime, readParser, parser);

export const freeWasmParser = (parser) => {
  // A trapped instance's allocator may be inconsistent; its memory is released
  // with the instance instead.
  if (parser.runtime.trap !== undefined) return;
  callWasm(parser.runtime, parser.wasm.streamfold_parser_free, parser.handle);
};
