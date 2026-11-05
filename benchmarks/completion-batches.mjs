import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as current from "streamfold";

const baselineEntry = process.argv[2];
if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
const baseline = await import(pathToFileURL(resolve(baselineEntry)));
await Promise.all([baseline.prepareStreamfold(), current.prepareStreamfold()]);
const implementations = { baseline, control: baseline, current };
const fixtures = [
  {
    name: "nested-records",
    value: { rows: Array.from({ length: 1000 }, (_, id) => ({ id, name: "hello", active: true })) },
    chunkSizes: [Infinity, 1024],
    paths: [[], ["rows"], ["rows", 0, "name"], ["rows", 999, "active"], ["missing"]],
  },
  {
    name: "numeric-array",
    value: Array.from({ length: 4000 }, (_, index) => index),
    chunkSizes: [Infinity, 1024],
    paths: [[], [0], [3999], ["missing"]],
  },
  {
    name: "ordinary-string-control",
    value: { value: "hello world ".repeat(400) },
    chunkSizes: [64],
    paths: [[], ["value"], ["missing"]],
  },
];
const warmups = 10;
const samples = 31;
const orders = [
  ["baseline", "control", "current"],
  ["current", "control", "baseline"],
  ["control", "current", "baseline"],
  ["baseline", "current", "control"],
  ["current", "baseline", "control"],
  ["control", "baseline", "current"],
];
const rows = [];
for (const fixture of fixtures) {
  const batch = fixture.name === "ordinary-string-control" ? 100 : 10;
  const text = JSON.stringify(fixture.value);
  for (const chunkSize of fixture.chunkSizes) {
    const size = Math.min(chunkSize, text.length);
    const chunks = Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
      text.slice(index * size, (index + 1) * size),
    );
    for (const snapshots of ["live", "immutable"]) {
      const left = baseline.createStructuredStream({ snapshots });
      const right = current.createStructuredStream({ snapshots });
      try {
        for (const chunk of chunks) {
          assert.deepEqual(right.push(chunk), left.push(chunk));
          for (const path of fixture.paths) {
            assert.equal(right.getFieldState(path), left.getFieldState(path));
          }
        }
        assert.deepEqual(right.finish(), left.finish());
        assert.deepEqual(right.value, JSON.parse(text));
      } finally {
        left.dispose();
        right.dispose();
      }
      const timings = { baseline: [], control: [], current: [] };
      for (let trial = 0; trial < warmups + samples; trial++) {
        for (const name of orders[trial % orders.length]) {
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
          assert.deepEqual(value, fixture.value);
          if (trial >= warmups) timings[name].push(duration);
        }
      }
      const row = {
        name: fixture.name,
        snapshots,
        bytes: Buffer.byteLength(text),
        chunks: chunks.length,
        chunkSize: chunkSize === Infinity ? "whole" : chunkSize,
        batch,
      };
      for (const name of Object.keys(implementations)) {
        const sorted = timings[name].toSorted((a, b) => a - b);
        row[name] = { medianMs: sorted[15], p95Ms: sorted[29], samplesMs: timings[name] };
      }
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../artifacts/completion-batches.json", import.meta.url),
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0].model,
        osRelease: release(),
      },
      baselineEntry: resolve(baselineEntry),
      warmups,
      samples,
      rows,
    },
    null,
    2,
  ) + "\n",
);
