import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const worker = async (entry, snapshots, requestedChunkSize) => {
  const entryUrl = pathToFileURL(resolve(entry));
  const api = await import(entryUrl);
  const { createWasmParser, freeWasmParser } = await import(new URL("internal/wasm-runtime.js", entryUrl));
  await api.prepareStreamfold();
  const expected = { rows: Array.from({ length: 2000 }, (_, id) => ({
    id, label: `item ${id}`, details: { category: "sample", score: 42, enabled: true }, tags: ["a", "b", "c"],
  })) };
  const text = JSON.stringify(expected);
  const chunkSize = Math.min(requestedChunkSize, text.length);
  const probe = createWasmParser({ maxBytes: 16 * 1024 * 1024, maxDepth: 128 });
  const initialWasmBytes = probe.wasm.memory.buffer.byteLength;
  const scanners = [];
  try {
    for (let id = 0; id < 32; id++) {
      const scanner = api.createStructuredStream({ snapshots });
      scanners.push(scanner);
      for (let offset = 0; offset < text.length; offset += chunkSize)
        scanner.push(text.slice(offset, offset + chunkSize));
      assert.deepEqual(scanner.finish().partialValue, expected);
      assert.equal(scanner.state.complete, true);
      assert.equal(scanner.getFieldState(["rows", 100, "details", "score"]), "complete");
    }
    const wasmBytes = probe.wasm.memory.buffer.byteLength;
    for (const scanner of scanners) {
      assert.deepEqual(scanner.value, expected);
      assert.equal(scanner.finish().partialValue, scanner.value);
      assert.equal(scanner.push(" ").partialValue, scanner.value);
      assert.equal(scanner.state.bytesSeen, Buffer.byteLength(text) + 1);
      assert.equal(scanner.finish().complete, true);
    }
    return {
      snapshots, chunkSize, scanners: scanners.length, rows: expected.rows.length,
      payloadBytes: Buffer.byteLength(text), initialWasmBytes, wasmBytes,
    };
  } finally {
    for (const scanner of scanners) scanner.dispose();
    freeWasmParser(probe);
  }
};

if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(await worker(process.argv[3], process.argv[4], Number(process.argv[5]))));
} else {
  const baselineEntry = process.argv[2];
  if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
  const entries = {
    baseline: resolve(baselineEntry),
    current: fileURLToPath(new URL("../packages/core/src/index.js", import.meta.url)),
  };
  const measurements = [];
  const results = [];
  for (const snapshots of ["live", "immutable"]) {
    for (const [delivery, chunkSize] of [["streamed", 4096], ["single-chunk", 1024 * 1024]]) {
      for (let trial = 0; trial < 3; trial++) {
        for (const implementation of trial % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
          const measurement = JSON.parse(execFileSync(process.execPath, [
            fileURLToPath(import.meta.url), "--worker", entries[implementation], snapshots, String(chunkSize),
          ], { encoding: "utf8" }));
          measurements.push({ implementation, delivery, trial, ...measurement });
        }
      }
      const result = { snapshots, delivery };
      for (const implementation of Object.keys(entries)) {
        const samples = measurements
          .filter((row) => row.snapshots === snapshots && row.delivery === delivery && row.implementation === implementation)
          .map((row) => row.wasmBytes)
          .sort((a, b) => a - b);
        result[implementation] = { medianWasmBytes: samples[1], p95WasmBytes: samples[2] };
      }
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../artifacts/finished-scanner-memory.json", import.meta.url), JSON.stringify({
    metric: "Wasm linear-memory high-water allocation, not JavaScript heap or process RSS",
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
    entries, warmups: 0, trials: 3, results, measurements,
  }, null, 2) + "\n");
}
