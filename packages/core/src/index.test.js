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
    '{"query":"a \\"quoted\\" value","items":[1,true,null,{"ok":false}]}';
  for (let split = 0; split <= input.length; split++) {
    const scanner = new IncrementalJsonScanner();
    scanner.push(input.slice(0, split));
    scanner.push(input.slice(split));
    assert.equal(scanner.state.complete, true, `split ${split}`);
    assert.equal(scanner.state.bytesSeen, input.length);
  }
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
