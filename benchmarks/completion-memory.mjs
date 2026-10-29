import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const worker = async (entry, snapshots) => {
  const api = await import(pathToFileURL(resolve(entry)));
  await api.prepareStreamfold();
  const rows = Array.from({ length: 2000 }, (_, id) => ({
    id,
    label: `row ${id}`,
    details: { category: "sample", score: 42, enabled: true },
    tags: ["a", "b", "c"],
  }));
  const prefix = '{"rows":[' + rows.map((row) => JSON.stringify(row)).join(",") + ',{"pending":"';
  const chunkSize = 4096;
  const chunks = [];
  for (let offset = 0; offset < prefix.length; offset += chunkSize)
    chunks.push(prefix.slice(offset, offset + chunkSize));
  const heap = () => {
    for (let i = 0; i < 4; i++) globalThis.gc();
    return process.memoryUsage().heapUsed;
  };
  for (let i = 0; i < 8; i++) {
    const stream = api.createStructuredStream({ snapshots });
    stream.push('{"rows":[{"id":1}]}');
    stream.finish();
    stream.dispose();
  }
  const before = heap();
  const streams = [];
  try {
    for (let i = 0; i < 16; i++) {
      const stream = api.createStructuredStream({ snapshots });
      streams.push(stream);
      for (const chunk of chunks) stream.push(chunk);
    }
    const openHeapBytes = heap() - before;
    for (const stream of streams) {
      assert.equal(stream.getFieldState(["rows", 100, "details", "score"]), "complete");
      assert.equal(stream.getFieldState(["rows", 2000, "pending"]), "partial");
      assert.equal(stream.getFieldState([]), "partial");
      stream.push('done"}]}');
      assert.deepEqual(stream.finish().partialValue, { rows: [...rows, { pending: "done" }] });
      assert.equal(stream.getFieldState(["rows", 100, "details", "score"]), "complete");
    }
    const closedHeapBytes = heap() - before;
    return {
      snapshots, streams: streams.length, rows: rows.length,
      bytesPerStream: Buffer.byteLength(prefix), chunkSize,
      openHeapBytes, closedHeapBytes,
    };
  } finally {
    for (const stream of streams) stream.dispose();
  }
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
  const results = [];
  for (const snapshots of ["live", "immutable"]) {
    const result = { snapshots };
    for (const implementation of Object.keys(entries)) {
      const group = measurements.filter((row) => row.snapshots === snapshots && row.implementation === implementation);
      result[implementation] = Object.fromEntries(["openHeapBytes", "closedHeapBytes"].map((key) => [
        key, group.map((row) => row[key]).sort((a, b) => a - b)[1],
      ]));
    }
    results.push(result);
    console.log(JSON.stringify(result));
  }
  mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../artifacts/completion-memory.json", import.meta.url), JSON.stringify({
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
    entries, warmups: 8, trials: 3, results, measurements,
  }, null, 2) + "\n");
}
