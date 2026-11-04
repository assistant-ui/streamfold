import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const worker = async (entry, count, snapshots) => {
  const { createStructuredStreamPool } = await import(pathToFileURL(resolve(entry)));
  const pool = createStructuredStreamPool({ maxBytes: 2, snapshots });
  pool.start("a", "{");
  const warmups = 1000;
  for (let i = 0; i < warmups; i++) pool.push("a", "");
  const heap = () => {
    for (let i = 0; i < 4; i++) globalThis.gc();
    return process.memoryUsage().heapUsed;
  };
  const before = heap();
  let update;
  for (let i = 0; i < count; i++) update = pool.push("a", "");
  const retainedHeapBytes = heap() - before;
  assert.equal(update.bytesSeen, 1);
  assert.deepEqual(update.partialValue, {});
  assert.deepEqual(update.changes, []);
  pool.push("a", "}");
  const result = pool.finish("a");
  assert.equal(result.text, "{}");
  assert.deepEqual(result.value, {});
  assert.equal(pool.size, 0);
  return { count, snapshots, warmups, chunkSize: 0, acceptedBytes: 1, retainedHeapBytes };
};

if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(await worker(process.argv[3], Number(process.argv[4]), process.argv[5])));
} else {
  const baselineEntry = process.argv[2];
  if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
  const entries = {
    baseline: resolve(baselineEntry),
    current: fileURLToPath(new URL("../packages/core/src/index.js", import.meta.url)),
  };
  const measurements = [];
  const results = [];
  for (const count of [100000, 500000]) {
    for (const snapshots of ["live", "immutable"]) {
      for (let trial = 0; trial < 3; trial++) {
        for (const implementation of trial % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
          const measurement = JSON.parse(execFileSync(process.execPath, [
            "--expose-gc", fileURLToPath(import.meta.url), "--worker", entries[implementation], String(count), snapshots,
          ], { encoding: "utf8" }));
          measurements.push({ implementation, trial, ...measurement });
        }
      }
      const row = { count, snapshots };
      for (const implementation of Object.keys(entries)) {
        const samples = measurements
          .filter((value) => value.count === count && value.snapshots === snapshots && value.implementation === implementation)
          .map((value) => value.retainedHeapBytes).sort((a, b) => a - b);
        row[implementation] = { medianHeapBytes: samples[1], p95HeapBytes: samples[2] };
      }
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../artifacts/empty-deltas-memory.json", import.meta.url), JSON.stringify({
    environment: { node: process.version, cpu: cpus()[0].model, platform: process.platform, arch: process.arch },
    entries, trials: 3, results, measurements,
  }, null, 2) + "\n");
}
