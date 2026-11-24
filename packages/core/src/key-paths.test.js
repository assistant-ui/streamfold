import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createStructuredStream } from "./index.js";

const indexUrl = new URL("./index.js", import.meta.url).href;
const runtimeUrl = new URL("./internal/wasm-runtime.js", import.meta.url).href;

// Runs one stream in a fresh process, because Wasm memory never shrinks and
// earlier tests would hide growth. Returns how many bytes the memory grew.
const measureGrowth = (source) => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createStructuredStream } from ${JSON.stringify(indexUrl)};
    import { createWasmParser, freeWasmParser } from ${JSON.stringify(runtimeUrl)};
    const probe = createWasmParser({ maxBytes: 16 * 1024 * 1024, maxDepth: 128 });
    const before = probe.wasm.memory.buffer.byteLength;
    const stream = createStructuredStream();
    try {
      ${source}
      console.log(JSON.stringify({ grown: probe.wasm.memory.buffer.byteLength - before }));
    } finally {
      stream.dispose();
      freeWasmParser(probe);
    }
  `], { encoding: "utf8", timeout: 60_000 });
  return JSON.parse(output).grown;
};

const limit = 64 * 1024 * 1024;

test("a long key under many values keeps Wasm memory proportional to the input", () => {
  const grown = measureGrowth(`
    const key = "k".repeat(1_000_000);
    const text = '{"' + key + '":[' + Array(2000).fill(0).join(",") + "]}";
    // The root stays open so the push reports a patch per value.
    const update = stream.push(text.slice(0, -1));
    assert.equal(update.complete, false);
    assert.equal(update.changes.length, 2 + 2000 * 2 + 1);
    for (const change of update.changes.slice(1)) assert.equal(change.path[0], key);
    assert.equal(stream.push("}").complete, true);
    assert.deepEqual(stream.finish().partialValue, { [key]: Array(2000).fill(0) });
  `);
  assert.ok(grown < limit, `Wasm memory grew by ${grown} bytes for a 1 MB input`);
});

test("a long key above deep nesting keeps Wasm memory proportional to the input", () => {
  const grown = measureGrowth(`
    const key = "k".repeat(4_000_000);
    const update = stream.push('{"' + key + '":' + "[".repeat(120));
    assert.equal(update.depth, 121);
    assert.deepEqual(update.changes.at(-1), { op: "set", path: [key, ...Array(119).fill(0)], value: [] });
    stream.push("]".repeat(120) + "}");
    let expected = [];
    for (let depth = 1; depth < 120; depth++) expected = [expected];
    assert.deepEqual(stream.finish().partialValue, { [key]: expected });
  `);
  assert.ok(grown < limit, `Wasm memory grew by ${grown} bytes for a 4 MB input`);
});

test("patch paths stay complete across pushes and independent of caller mutation", () => {
  const long = "k".repeat(300) + "é";
  const text = JSON.stringify({ [long]: [1, { [long]: "ab", n: null }], z: true });
  const read = (mutate) => {
    const stream = createStructuredStream();
    const changes = [];
    const collect = ({ changes: update }) => {
      for (const change of update) {
        changes.push(structuredClone(change));
        if (mutate) change.path.splice(0, Infinity, "mutated");
      }
    };
    for (const char of text) collect(stream.push(char));
    collect(stream.finish());
    stream.dispose();
    return changes;
  };

  const changes = read(false);
  assert.deepEqual(read(true), changes);
  assert.deepEqual(
    changes.filter((change) => change.op !== "append"),
    [
      { op: "set", path: [], value: {} },
      { op: "set", path: [long], value: [] },
      { op: "set", path: [long, 0], value: 1 },
      { op: "complete", path: [long, 0] },
      { op: "set", path: [long, 1], value: {} },
      { op: "set", path: [long, 1, long], value: "" },
      { op: "complete", path: [long, 1, long] },
      { op: "set", path: [long, 1, "n"], value: null },
      { op: "complete", path: [long, 1, "n"] },
      { op: "complete", path: [long, 1] },
      { op: "complete", path: [long] },
      { op: "set", path: ["z"], value: true },
      { op: "complete", path: ["z"] },
      { op: "complete", path: [] },
    ],
  );
  assert.deepEqual(
    changes.filter((change) => change.op === "append"),
    [
      { op: "append", path: [long, 1, long], value: "a" },
      { op: "append", path: [long, 1, long], value: "b" },
    ],
  );
});
