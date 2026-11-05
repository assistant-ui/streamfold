import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as current from "streamfold";

const baselineEntry = process.argv[2];
if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
const baseline = await import(pathToFileURL(resolve(baselineEntry)));
await Promise.all([baseline.prepareStreamfold(), current.prepareStreamfold()]);
const implementations = { baseline, current };
const warmups = 10;
const samples = 31;
const batch = 10;
const chunkSize = 64;
const rows = [];
for (const [shape, key] of [
  ["short-control", "key"],
  ["long-ascii", "k".repeat(2048)],
  ["long-unicode", "é界🚀".repeat(400)],
  ["escaped-surrogate", "k".repeat(1024) + "\uD800" + "k".repeat(1024)],
  ["replacement-character", "k".repeat(1024) + "\uFFFD" + "k".repeat(1024)],
  ["many-escaped-surrogates", ("k\uD800").repeat(1024) + "tail"],
]) {
  const expected = { [key]: "hello ".repeat(2731) };
  const text = JSON.stringify(expected);
  const chunks = Array.from({ length: Math.ceil(text.length / chunkSize) }, (_, index) => text.slice(index * chunkSize, (index + 1) * chunkSize));
  for (const snapshots of ["live", "immutable"]) {
    const left = baseline.createStructuredStream({ snapshots });
    const right = current.createStructuredStream({ snapshots });
    try {
      for (const chunk of chunks) {
        assert.deepEqual(right.push(chunk), left.push(chunk));
        assert.equal(right.getFieldState([key]), left.getFieldState([key]));
      }
      assert.deepEqual(right.finish(), left.finish());
      assert.deepEqual(right.value, expected);
    } finally {
      left.dispose();
      right.dispose();
    }
    const timings = { baseline: [], current: [] };
    for (let trial = 0; trial < warmups + samples; trial++) {
      for (const name of trial % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
        let value;
        const start = performance.now();
        for (let repeat = 0; repeat < batch; repeat++) {
          const scanner = implementations[name].createStructuredStream({ snapshots });
          try {
            for (const chunk of chunks) scanner.push(chunk);
            value = scanner.finish().partialValue;
          } finally {
            scanner.dispose();
          }
        }
        const duration = (performance.now() - start) / batch;
        assert.deepEqual(value, expected);
        if (trial >= warmups) timings[name].push(duration);
      }
    }
    const row = { shape, snapshots, keyUnits: key.length, bytes: Buffer.byteLength(text), chunks: chunks.length, chunkSize };
    for (const name of Object.keys(implementations)) {
      const sorted = timings[name].toSorted((a, b) => a - b);
      row[name] = { medianMs: sorted[15], p95Ms: sorted[29] };
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("../artifacts/property-keys.json", import.meta.url), JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
  baselineEntry: resolve(baselineEntry), warmups, samples, batch, rows,
}, null, 2) + "\n");
