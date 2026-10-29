import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const assertFrozen = (value) => {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozen(child);
};

const worker = async (entry, snapshots) => {
  const api = await import(pathToFileURL(resolve(entry)));
  await api.prepareStreamfold();
  const expected = {
    rows: Array.from({ length: 2000 }, (_, id) => ({
      id,
      label: `row ${id}`,
      details: { category: "sample", score: 42, enabled: true },
      tags: ["a", "b", "c"],
    })),
  };
  const text = JSON.stringify(expected);
  const chunks = [];
  const chunkSize = 4096;
  for (let offset = 0; offset < text.length; offset += chunkSize)
    chunks.push(text.slice(offset, offset + chunkSize));
  const pool = api.createStructuredStreamPool({ snapshots });
  for (let i = 0; i < 8; i++) {
    pool.start("warmup", '{"rows":[{"id":1}]}');
    pool.finish("warmup");
  }
  const heap = () => {
    for (let i = 0; i < 4; i++) globalThis.gc();
    return process.memoryUsage().heapUsed;
  };
  const before = heap();
  const results = [];
  for (let id = 0; id < 16; id++) {
    pool.start(id);
    for (const chunk of chunks) pool.push(id, chunk);
    const result = pool.finish(id);
    assert.deepEqual(result.value, expected);
    assert.deepEqual(result.partialValue, expected);
    assert.equal(result.text, text);
    if (snapshots === "immutable") {
      assertFrozen(result.value);
      assertFrozen(result.partialValue);
    }
    results.push(result);
  }
  assert.equal(pool.size, 0);
  const retainedHeapBytes = heap() - before;
  return {
    snapshots,
    results: results.length,
    rows: expected.rows.length,
    bytesPerResult: Buffer.byteLength(text),
    chunkSize,
    retainedHeapBytes,
    sharedFinalSnapshot: results[0].value === results[0].partialValue,
  };
};

if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(await worker(process.argv[3], process.argv[4])));
} else {
  const baselineEntry = process.argv[2];
  if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
  const entries = {
    baseline: resolve(baselineEntry),
    current: fileURLToPath(new URL("../packages/core/src/index.js", import.meta.url)),
  };
  const measurements = [];
  for (const snapshots of ["live", "immutable"]) {
    for (let trial = 0; trial < 3; trial++) {
      for (const implementation of trial % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
        const measurement = JSON.parse(execFileSync(process.execPath, [
          "--expose-gc", fileURLToPath(import.meta.url), "--worker", entries[implementation], snapshots,
        ], { encoding: "utf8" }));
        measurements.push({ trial, implementation, ...measurement });
      }
    }
  }
  const results = ["live", "immutable"].map((snapshots) => ({
    snapshots,
    ...Object.fromEntries(Object.keys(entries).map((implementation) => {
      const samples = measurements
        .filter((row) => row.snapshots === snapshots && row.implementation === implementation)
        .map((row) => row.retainedHeapBytes)
        .sort((a, b) => a - b);
      return [implementation, { medianHeapBytes: samples[1], p95HeapBytes: samples[2] }];
    })),
  }));
  for (const result of results) console.log(JSON.stringify(result));
  mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../artifacts/final-value-memory.json", import.meta.url), JSON.stringify({
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
    entries, warmups: 8, trials: 3, results, measurements,
  }, null, 2) + "\n");
}
