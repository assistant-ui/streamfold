import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createStructuredStream } from "./index.js";

test("finished scanners release scratch space while their values stay reachable", () => {
  for (const snapshots of ["live", "immutable"]) {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { createStructuredStream } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
      import { createWasmParser, freeWasmParser } from ${JSON.stringify(new URL("./internal/wasm-runtime.js", import.meta.url).href)};
      const expected = { rows: Array.from({ length: 2000 }, (_, id) => ({
        id, label: "item " + id, details: { category: "sample", score: 42, enabled: true }, tags: ["a", "b", "c"],
      })) };
      const text = JSON.stringify(expected);
      const probe = createWasmParser({ maxBytes: 16 * 1024 * 1024, maxDepth: 128 });
      const scanners = [];
      let firstPeak;
      try {
        for (let i = 0; i < 16; i++) {
          const scanner = createStructuredStream({ snapshots: ${JSON.stringify(snapshots)} });
          scanners.push(scanner);
          scanner.push(text);
          assert.deepEqual(scanner.finish().partialValue, expected);
          firstPeak ??= probe.wasm.memory.buffer.byteLength;
        }
        const finalPeak = probe.wasm.memory.buffer.byteLength;
        for (const scanner of scanners) {
          assert.deepEqual(scanner.value, expected);
          assert.equal(scanner.state.complete, true);
          assert.equal(scanner.getFieldState(["rows", 100, "details", "score"]), "complete");
        }
        console.log(JSON.stringify({ firstPeak, finalPeak }));
      } finally {
        for (const scanner of scanners) scanner.dispose();
        freeWasmParser(probe);
      }
    `], { encoding: "utf8", timeout: 30_000 });
    const { firstPeak, finalPeak } = JSON.parse(output);
    assert.ok(finalPeak <= firstPeak * 2 + 1024 * 1024,
      `${snapshots}: Wasm allocation grew from ${firstPeak} to ${finalPeak} bytes for completed scanners`);
  }
});

test("finalized scanners preserve patches, values, state, and repeated operations", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const text of ["42", "-0", "1e400", "null", '"é🚀"', '[1,{"ok":true}]']) {
      const scanner = createStructuredStream({ snapshots });
      try {
        const split = Math.floor(text.length / 2);
        scanner.push(text.slice(0, split));
        scanner.push(text.slice(split));
        const final = scanner.finish();
        assert.deepEqual(final.partialValue, JSON.parse(text));
        assert.equal(final.complete, true);
        assert.equal(scanner.value, final.partialValue);
        assert.equal(scanner.state.bytesSeen, Buffer.byteLength(text));
        assert.equal(scanner.getFieldState([]), "complete");
        if (typeof final.partialValue === "number")
          assert.deepEqual(final.changes, [{ op: "complete", path: [] }]);
        const repeated = scanner.finish();
        assert.equal(repeated.partialValue, final.partialValue);
        assert.deepEqual(repeated.changes, []);
        assert.equal(scanner.push(" \n").partialValue, final.partialValue);
        assert.equal(scanner.state.bytesSeen, Buffer.byteLength(text) + 2);
        assert.equal(scanner.finish().complete, true);
        assert.throws(() => scanner.push("x"), { code: "TRAILING_DATA" });
      } finally {
        scanner.dispose();
        scanner.dispose();
      }
    }
  }
});
