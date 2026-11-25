import assert from "node:assert/strict";
import test from "node:test";
import {
  createStructuredStream,
  createStructuredStreamPool,
  DEFAULT_STREAM_LIMITS,
  defineAdapter,
  IncrementalJsonScanner,
  readStructured,
  StructuredStreamPool,
} from "./index.js";
import { normalizeStreamLimits } from "./internal/options.js";
import { langchain } from "./langchain.js";
import { createToolInputParser } from "./vercel-ai.js";

const invalid = (ErrorClass, ...patterns) => (error) => {
  assert.equal(error.code, "INVALID_OPTIONS");
  assert.equal(error.streamfold, true);
  assert.ok(error instanceof ErrorClass, `expected ${ErrorClass.name}, got ${error.name}`);
  for (const pattern of patterns) assert.match(error.message, pattern);
  return true;
};

const adapter = defineAdapter((operations) => operations);
const drain = async (iterator) => {
  for await (const _ of iterator);
};

test("null numeric limits are reported at each applicable entry point", async () => {
  const limits = { maxBytes: null, maxDepth: null, maxActiveStreams: null };
  const bytes = /maxBytes [^;]*\(received null\)/;
  const depth = /maxDepth [^;]*\(received null\)/;
  const active = /maxActiveStreams [^;]*\(received null\)/;
  const streamError = invalid(RangeError, bytes, depth);
  const poolError = invalid(RangeError, bytes, depth, active);

  assert.throws(() => new IncrementalJsonScanner(limits), streamError);
  assert.throws(() => createStructuredStream(limits), streamError);
  assert.throws(() => createToolInputParser(limits), streamError);
  assert.throws(() => new StructuredStreamPool(limits), poolError);
  assert.throws(() => createStructuredStreamPool(limits), poolError);
  assert.throws(() => adapter(limits), poolError);
  await assert.rejects(drain(readStructured([], { adapter, limits })), poolError);
  await assert.rejects(drain(readStructured([], { integration: langchain, limits })), poolError);
});

test("null limits are aggregated with other invalid options", () => {
  assert.throws(
    () => createStructuredStreamPool({ maxBytes: null, maxDepth: 0, snapshots: "bad" }),
    invalid(
      TypeError,
      /maxBytes [^;]*received null/,
      /maxDepth [^;]*received 0/,
      /snapshots [^;]*received "bad"/,
    ),
  );
});

test("omitted and undefined numeric limits resolve to the documented defaults", () => {
  const expected = { ...DEFAULT_STREAM_LIMITS, snapshots: "live" };
  assert.deepEqual(normalizeStreamLimits({}, true), expected);
  assert.deepEqual(
    normalizeStreamLimits(
      { maxBytes: undefined, maxDepth: undefined, maxActiveStreams: undefined },
      true,
    ),
    expected,
  );
});

test("maxDepth is capped at the parser's 16-bit path length", () => {
  const deepest = new IncrementalJsonScanner({ maxDepth: 65_535 });
  assert.equal(deepest.push("[[1").depth, 2);
  deepest.dispose();
  createStructuredStreamPool({ maxDepth: 65_535 });

  const capped = /maxDepth must be an integer between 1 and 65535/;
  for (const maxDepth of [65_536, 1_000_000, 0xffff_ffff]) {
    const received = new RegExp(`\\(received ${maxDepth}\\)`);
    assert.throws(() => new IncrementalJsonScanner({ maxDepth }), invalid(RangeError, capped, received));
    assert.throws(() => createStructuredStream({ maxDepth }), invalid(RangeError, capped));
    assert.throws(() => createStructuredStreamPool({ maxDepth }), invalid(RangeError, capped));
    assert.throws(() => adapter({ maxDepth }), invalid(RangeError, capped));
    assert.throws(() => createToolInputParser({ maxDepth }), invalid(RangeError, capped));
  }
});

test("every invalid option is reported in one error", () => {
  const options = { maxBytes: NaN, maxDepth: -1, maxActiveStreams: "x", snapshots: "bad" };
  const bytes = /maxBytes must be an integer between 1 and 4294967295 \(received NaN\)/;
  const depth = /maxDepth must be an integer between 1 and 65535 \(received -1\)/;
  const active = /maxActiveStreams must be an integer between 1 and 4294967295 \(received "x"\)/;
  const snapshots = /snapshots must be "live" or "immutable" \(received "bad"\)/;

  // Scanners validate their own keys; maxActiveStreams only applies to pools.
  assert.throws(() => new IncrementalJsonScanner(options), invalid(TypeError, bytes, depth, snapshots));
  assert.throws(() => createStructuredStream(options), invalid(TypeError, bytes, depth, snapshots));
  assert.throws(() => new StructuredStreamPool(options), invalid(TypeError, bytes, depth, active, snapshots));
  assert.throws(() => createStructuredStreamPool(options), invalid(TypeError, bytes, depth, active, snapshots));
  assert.throws(() => adapter(options), invalid(TypeError, bytes, depth, active, snapshots));

  // Limit problems alone keep the RangeError class.
  assert.throws(
    () => createStructuredStreamPool({ maxBytes: 0, maxActiveStreams: 1.5 }),
    invalid(RangeError, /maxBytes .*received 0\); maxActiveStreams .*received 1\.5\)/),
  );
  // A lone snapshot problem keeps the TypeError class.
  assert.throws(() => createStructuredStreamPool({ snapshots: "typo" }), invalid(TypeError, /received "typo"/));
});

test("readStructured reports every invalid limit for adapters and integrations", async () => {
  const limits = { maxBytes: NaN, maxDepth: 70_000, maxActiveStreams: "x" };
  const patterns = [/maxBytes .*NaN/, /maxDepth .*65535 \(received 70000\)/, /maxActiveStreams .*"x"/];
  await assert.rejects(drain(readStructured([], { adapter, limits })), invalid(RangeError, ...patterns));
  await assert.rejects(
    drain(readStructured([], { adapter, limits, onDiagnostic() {} })),
    invalid(RangeError, ...patterns),
  );
  await assert.rejects(
    drain(readStructured([], { integration: langchain, limits })),
    invalid(RangeError, ...patterns),
  );
});

test("non-object options fail with INVALID_OPTIONS", async () => {
  for (const options of [null, 5, "maxBytes", [], () => {}]) {
    const shape = /Streamfold options must be an object or undefined/;
    assert.throws(() => new IncrementalJsonScanner(options), invalid(TypeError, shape));
    assert.throws(() => new StructuredStreamPool(options), invalid(TypeError, shape));
    assert.throws(() => createStructuredStreamPool(options), invalid(TypeError, shape));
    assert.throws(() => adapter(options), invalid(TypeError, shape));
    assert.throws(() => createToolInputParser(options), invalid(TypeError, shape));
    await assert.rejects(
      drain(readStructured([], { adapter, limits: options, onDiagnostic() {} })),
      invalid(TypeError, /limits must be an object or undefined/),
    );
    await assert.rejects(
      drain(readStructured([], { integration: langchain, limits: options })),
      invalid(TypeError, /limits must be an object or undefined/),
    );
  }
  assert.throws(() => new IncrementalJsonScanner(null), invalid(TypeError, /\(received null\)/));

  new IncrementalJsonScanner().dispose();
  new IncrementalJsonScanner(undefined).dispose();
  createStructuredStreamPool(undefined);
  createToolInputParser(undefined).dispose();
});

test("unknown option keys are still ignored", () => {
  // Adapters pass their whole options object, including onDiagnostic, to the pool.
  const pool = createStructuredStreamPool({ onDiagnostic() {}, maxbytes: 2 });
  assert.equal(pool.start("a", '{"a":1}').bytesSeen, 7);
  pool.abort("a");
  const scanner = new IncrementalJsonScanner({ maxActiveStreams: "x", maxbytes: 2 });
  assert.equal(scanner.push("[1]").complete, true);
  scanner.dispose();
});
