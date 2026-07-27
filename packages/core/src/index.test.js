import assert from "node:assert/strict";
import test from "node:test";
import {
  IncrementalJsonScanner,
  STREAMFOLD_ENGINE,
  StructuredStreamPool,
} from "./index.js";

test("runs the published scanner through the Rust WebAssembly backend", () => {
  const scanner = new IncrementalJsonScanner();
  assert.equal(STREAMFOLD_ENGINE, "rust-wasm");
  assert.equal(scanner.backend, "rust-wasm");
  scanner.dispose();
  assert.throws(() => scanner.push("{}"), /disposed/);
});

test("incrementally scans every possible two-part split", () => {
  const input =
    '{"query":"a \\"quoted\\" 👋 value","items":[1,true,null,{"ok":false}]}';
  for (let split = 0; split <= input.length; split++) {
    const scanner = new IncrementalJsonScanner();
    scanner.push(input.slice(0, split));
    const update = scanner.push(input.slice(split));
    assert.equal(scanner.state.complete, true, `split ${split}`);
    assert.equal(scanner.state.bytesSeen, Buffer.byteLength(input));
    assert.deepEqual(update.partialValue, JSON.parse(input), `split ${split}`);
    scanner.dispose();
  }
});

test("preserves surrogate pairs split across separate pushes", () => {
  const input = '{"message":"Hello 👋 from Streamfold"}';
  const scanner = new IncrementalJsonScanner();

  for (let index = 0; index < input.length; index++) {
    scanner.push(input[index]);
  }

  const update = scanner.finish();
  assert.deepEqual(update.partialValue, JSON.parse(input));
  assert.equal(update.bytesSeen, Buffer.byteLength(input));
  scanner.dispose();
});

test("reports useful partial structural state", () => {
  const scanner = new IncrementalJsonScanner();
  const state = scanner.push('{"items":[{"name":"hel');
  assert.deepEqual({
    bytesSeen: state.bytesSeen,
    depth: state.depth,
    complete: state.complete,
    inString: state.inString,
  }, {
    bytesSeen: 22,
    depth: 3,
    complete: false,
    inString: true,
  });
  assert.deepEqual(state.partialValue, { items: [{ name: "hel" }] });
  assert.equal(state.changes.length, 5);
});

test("finishes primitive values at the stream boundary", () => {
  const scanner = new IncrementalJsonScanner();
  scanner.push("42");
  assert.equal(scanner.state.complete, false);
  assert.equal(scanner.finish().complete, true);
});

test("reports UTF-8 bytes for non-ASCII input", () => {
  const scanner = new IncrementalJsonScanner();
  const input = '{"message":"Hello, 世界 👋"}';
  const state = scanner.push(input);
  assert.equal(state.bytesSeen, Buffer.byteLength(input));
  assert.equal(state.complete, true);
  scanner.dispose();
});

test("translates Rust parser failures into JavaScript syntax errors", () => {
  const empty = new IncrementalJsonScanner();
  assert.throws(() => empty.finish(), /Empty JSON input/);
  empty.dispose();

  const mismatched = new IncrementalJsonScanner();
  assert.throws(() => mismatched.push("{]"), /Mismatched closing at 1/);
  mismatched.dispose();

  const incomplete = new IncrementalJsonScanner();
  incomplete.push('{"value":"partial');
  assert.throws(() => incomplete.finish(), /Incomplete JSON at 17/);
  incomplete.dispose();

  const trailing = new IncrementalJsonScanner();
  trailing.push("{}");
  assert.throws(() => trailing.push("x"), /Trailing data at 2/);
  trailing.dispose();
});

test("keeps concurrent streams isolated and parses once on completion", () => {
  const pool = new StructuredStreamPool();
  pool.start("first");
  pool.start("second");
  pool.push("first", '{"value":');
  pool.push("second", '{"value":2}');
  pool.push("first", "1}");

  assert.deepEqual(pool.finish("second").value, { value: 2 });
  assert.deepEqual(pool.finish("first").value, { value: 1 });
  assert.equal(pool.size, 0);
});

test("releases aborted streams", () => {
  const pool = new StructuredStreamPool();
  pool.start("cancelled", '{"value":');
  assert.equal(pool.abort("cancelled"), true);
  assert.equal(pool.abort("cancelled"), false);
  assert.throws(() => pool.push("cancelled", "1}"), /Unknown structured stream/);
});

test("enforces byte and depth limits with terminal failures", () => {
  const bytes = new IncrementalJsonScanner({ maxBytes: 8 });
  let byteFailure;
  assert.throws(() => bytes.push('{"value":1}'), (error) => {
    byteFailure = error;
    return /maxBytes \(8\)/.test(error.message);
  });
  assert.throws(() => bytes.push("{}"), (error) => error === byteFailure);
  bytes.dispose();

  const depth = new IncrementalJsonScanner({ maxDepth: 2 });
  assert.throws(() => depth.push('{"value":[['), /maxDepth \(2\)/);
  assert.throws(() => depth.finish(), /maxDepth \(2\)/);
  depth.dispose();

  const utf8 = new IncrementalJsonScanner({ maxBytes: 4 });
  assert.equal(utf8.push('"é"').complete, true);
  utf8.dispose();
  assert.throws(
    () => new IncrementalJsonScanner({ maxBytes: 3 }).push('"é"'),
    /maxBytes \(3\)/,
  );

  assert.throws(
    () => new IncrementalJsonScanner({ maxDepth: 0 }),
    /maxDepth must be an integer/,
  );
});

test("bounds active streams and cleans up failed pool entries", () => {
  const bounded = new StructuredStreamPool({ maxActiveStreams: 1 });
  bounded.start("first");
  assert.throws(() => bounded.start("second"), /maxActiveStreams \(1\)/);
  bounded.abort("first");

  const malformed = new StructuredStreamPool();
  malformed.start("broken");
  assert.throws(() => malformed.push("broken", "{]"), SyntaxError);
  assert.equal(malformed.size, 0);

  assert.throws(() => malformed.start("initial", "{]"), SyntaxError);
  assert.equal(malformed.size, 0);

  const incomplete = new StructuredStreamPool();
  incomplete.start("broken", '{"value":');
  assert.throws(() => incomplete.finish("broken"), SyntaxError);
  assert.equal(incomplete.size, 0);
});
