import assert from "node:assert/strict";
import test from "node:test";
import {
  IncrementalJsonScanner,
  STREAMFOLD_ENGINE,
  StructuredStreamPool,
} from "./index.js";
import { createWasmParser, freeWasmParser } from "./internal/wasm-runtime.js";

test("rejects unpaired raw UTF-16 instead of returning inconsistent partial and final values", () => {
  for (const units of [[0xd800], [0xdc00], [0xd800, 0xd800], [0xd800, 0x61]]) {
    const value = String.fromCharCode(...units);
    const pool = new StructuredStreamPool();
    pool.start("raw");
    assert.throws(() => pool.push("raw", '{"value":"' + value + '"}'), {
      name: "TypeError",
      code: "INVALID_CHUNK",
    });
    assert.equal(pool.size, 0);

    // JSON Unicode escapes are lossless and remain valid, even when unpaired.
    pool.start("escaped");
    pool.push("escaped", JSON.stringify({ value }));
    const result = pool.finish("escaped");
    assert.deepEqual(result.partialValue, { value });
    assert.deepEqual(result.partialValue, result.value);
  }
});

test("validates a buffered high surrogate on the next chunk or finish", () => {
  for (const finish of [false, true]) {
    const pool = new StructuredStreamPool();
    pool.start("split", '{"value":"');
    pool.push("split", String.fromCharCode(0xd800));
    assert.throws(() => finish ? pool.finish("split") : pool.push("split", '"}'), {
      name: "TypeError",
      code: "INVALID_CHUNK",
    });
    assert.equal(pool.size, 0);
  }
});

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

test("rejects raw controls after string runs at the original byte offset", () => {
  for (let control = 0; control < 0x20; control++) {
    for (const prefix of ['{"', '{"value":"']) {
      const before = prefix + "é".repeat(128);
      const input = before + String.fromCharCode(control) + 'tail"}';
      for (const split of [0, prefix.length + 64, before.length]) {
        const scanner = new IncrementalJsonScanner();
        try {
          assert.throws(() => {
            scanner.push(input.slice(0, split));
            scanner.push(input.slice(split));
          }, { name: "SyntaxError", code: "INVALID_JSON", byteOffset: Buffer.byteLength(before) });
        } finally {
          scanner.dispose();
        }
      }
    }
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

test("rejects non-JSON whitespace across chunk boundaries", () => {
  for (const whitespace of ["\v", "\f"]) {
    for (const input of [
      `${whitespace}{}`,
      `{"value":${whitespace}1}`,
      `[1,${whitespace}2]`,
      `{}${whitespace}`,
      `1${whitespace}`,
    ]) {
      for (let split = 0; split <= input.length; split++) {
        const scanner = new IncrementalJsonScanner();
        try {
          assert.throws(() => {
            scanner.push(input.slice(0, split));
            scanner.push(input.slice(split));
            scanner.finish();
          }, SyntaxError, `${JSON.stringify(input)} at split ${split}`);
        } finally {
          scanner.dispose();
        }
      }
    }
  }
});

test("accepts JSON whitespace and escaped form-feed values", () => {
  const input = ' \t\r\n{ "value": "\\f" } \t\r\n';
  const scanner = new IncrementalJsonScanner();
  try {
    for (const character of input) scanner.push(character);
    assert.deepEqual(scanner.finish().partialValue, { value: "\f" });
  } finally {
    scanner.dispose();
  }
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

test("enforces the remaining UTF-8 byte budget before growing WASM memory", () => {
  const probe = createWasmParser({ maxBytes: 8, maxDepth: 128 });
  const before = probe.wasm.memory.buffer.byteLength;
  const oversized = new IncrementalJsonScanner({ maxBytes: 8 });
  try {
    let failure;
    assert.throws(
      () => oversized.push('"' + "x".repeat(4 * 1024 * 1024) + '"'),
      (error) => {
        failure = error;
        return error.code === "MAX_BYTES_EXCEEDED";
      },
    );
    assert.equal(probe.wasm.memory.buffer.byteLength, before);
    assert.throws(() => oversized.push("{}"), (error) => error === failure);
  } finally {
    oversized.dispose();
    freeWasmParser(probe);
  }

  const multibyte = new IncrementalJsonScanner({ maxBytes: 8 });
  try {
    multibyte.push('"');
    assert.throws(() => multibyte.push("éééé"), (error) => {
      assert.equal(error.code, "MAX_BYTES_EXCEEDED");
      assert.match(error.message, /maxBytes \(8\)/);
      return true;
    });
  } finally {
    multibyte.dispose();
  }

  const exact = new IncrementalJsonScanner({ maxBytes: 6 });
  try {
    exact.push('"');
    exact.push("éé");
    assert.equal(exact.push('"').complete, true);
  } finally {
    exact.dispose();
  }
});

test("byte-limit failures report the accepted UTF-8 offset and stay terminal", () => {
  for (const [prefix, rejected, byteOffset] of [
    ['"abc', 'def"', 4],
    ['"é', 'éé"', 3],
  ]) {
    const scanner = new IncrementalJsonScanner({ maxBytes: 6 });
    try {
      assert.equal(scanner.push(prefix).bytesSeen, byteOffset);
      let failure;
      assert.throws(() => scanner.push(rejected), (error) => {
        failure = error;
        assert.equal(error.code, "MAX_BYTES_EXCEEDED");
        assert.equal(error.byteOffset, byteOffset);
        assert.equal(error.message, `Structured stream exceeds maxBytes (6) at ${byteOffset}`);
        return true;
      });
      assert.throws(() => scanner.finish(), (error) => error === failure);
    } finally {
      scanner.dispose();
    }
  }
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
