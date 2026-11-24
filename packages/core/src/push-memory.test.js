import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createStructuredStream } from "./index.js";

const indexUrl = new URL("./index.js", import.meta.url).href;
const runtimeUrl = new URL("./internal/wasm-runtime.js", import.meta.url).href;

// Runs in a fresh process, because Wasm memory never shrinks and earlier tests
// would hide growth. Returns how many bytes the shared instance's memory grew.
const measureGrowth = (source) => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createStructuredStream, createStructuredStreamPool } from ${JSON.stringify(indexUrl)};
    import { createWasmParser, freeWasmParser } from ${JSON.stringify(runtimeUrl)};
    const probe = createWasmParser({ maxBytes: 16 * 1024 * 1024, maxDepth: 128 });
    const before = probe.wasm.memory.buffer.byteLength;
    const digits = (count) => "[" + Array.from({ length: count }, (_, i) => i % 10).join(",") + "]";
    try {
      ${source}
      console.log(JSON.stringify({ grown: probe.wasm.memory.buffer.byteLength - before }));
    } finally {
      freeWasmParser(probe);
    }
  `], { encoding: "utf8", timeout: 60_000 });
  return JSON.parse(output).grown;
};

const MiB = 1024 * 1024;

test("one whole-document push does not build all of its patches in Wasm memory", () => {
  // 2,000,000 elements make a 4 MB document and 4,000,002 patches. Before
  // patches were batched, this grew Wasm memory by about 140 MiB.
  const grown = measureGrowth(`
    const count = 2_000_000;
    const streams = [createStructuredStream(), createStructuredStream()];
    for (const stream of streams) {
      const update = stream.push(digits(count));
      assert.equal(update.complete, true);
      assert.equal(update.changes.length, 2 + count * 2);
      assert.deepEqual(update.changes[0], { op: "set", path: [], value: [] });
      for (let i = 0; i < count; i++) {
        const set = update.changes[1 + i * 2];
        const complete = update.changes[2 + i * 2];
        if (set.op !== "set" || set.path[0] !== i || set.value !== i % 10 ||
            complete.op !== "complete" || complete.path[0] !== i) {
          assert.fail("patch " + i + " is " + JSON.stringify([set, complete]));
        }
      }
      assert.deepEqual(update.changes.at(-1), { op: "complete", path: [] });
    }
    // The second stream reuses what the first one returned to the allocator.
    for (const stream of streams) {
      assert.equal(stream.finish().partialValue.length, count);
      stream.dispose();
    }
  `);
  assert.ok(grown < 16 * MiB, `Wasm memory grew by ${grown} bytes for two 4 MB pushes`);
});

test("replacing a pool stream's text on finish keeps Wasm growth bounded", () => {
  const grown = measureGrowth(`
    const count = 2_000_000;
    const pool = createStructuredStreamPool();
    pool.start("call", "[");
    const result = pool.finish("call", digits(count));
    assert.equal(result.complete, true);
    assert.equal(result.value.length, count);
    assert.equal(result.value[count - 1], (count - 1) % 10);
  `);
  assert.ok(grown < 16 * MiB, `Wasm memory grew by ${grown} bytes for a 4 MB final text`);
});

test("one long string push sizes its input from UTF-8 and appends once", () => {
  // Before, this grew Wasm memory by about 39 MiB: a 12 MB input buffer for
  // 4 MB of ASCII, and a patch buffer that doubled past the appended text.
  const grown = measureGrowth(`
    const text = "x".repeat(4_000_000);
    const stream = createStructuredStream();
    const update = stream.push(JSON.stringify(text));
    assert.equal(update.changes.length, 3);
    assert.equal(update.changes[1].op, "append");
    assert.equal(update.changes[1].value, text);
    assert.equal(stream.finish().partialValue, text);
    stream.dispose();
  `);
  assert.ok(grown < 28 * MiB, `Wasm memory grew by ${grown} bytes for a 4 MB string`);
});

test("non-ASCII whole-document pushes keep their values and byte counts", () => {
  for (const snapshots of ["live", "immutable"]) {
    const value = {
      ascii: "a".repeat(70_000),
      mixed: "é🚀".repeat(30_000) + "tail",
      items: Array.from({ length: 20_000 }, (_, i) => ({ id: i, label: "ü" + i })),
    };
    const text = JSON.stringify(value);
    const stream = createStructuredStream({ snapshots });
    try {
      const update = stream.push(text);
      assert.equal(update.bytesSeen, Buffer.byteLength(text));
      assert.deepEqual(update.partialValue, value);
      assert.deepEqual(stream.finish().partialValue, value);
    } finally {
      stream.dispose();
    }
  }
});
