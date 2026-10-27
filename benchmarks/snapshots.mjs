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

const values = Array.from({ length: 2000 }, (_, index) => index + 0.5);
const cases = [
  ["dense-array", { values }],
  ["nested-array", { rows: values.slice(0, 250).map((n) => ({ n, tags: [n, "ok"] })) }],
  ["dense-object", Object.fromEntries(values.map((n, index) => [`key${index}`, n]))],
];
const implementations = { baseline, current };
const warmups = 5;
const samples = 20;
const rows = [];

for (const snapshots of ["live", "immutable"]) {
  for (const [shape, value] of cases) {
    const input = JSON.stringify(value);
    for (const chunkSize of [16, 256]) {
      const chunks = [];
      for (let offset = 0; offset < input.length; offset += chunkSize)
        chunks.push(input.slice(offset, offset + chunkSize));
      const probes = [baseline, current].map((api) => api.createStructuredStream({ snapshots }));
      try {
        for (const chunk of chunks)
          assert.deepEqual(probes[0].push(chunk), probes[1].push(chunk));
      } finally {
        for (const probe of probes) probe.dispose();
      }
      const timings = { baseline: [], current: [] };
      for (let iteration = 0; iteration < warmups + samples; iteration++) {
        const order = iteration % 2 ? ["current", "baseline"] : ["baseline", "current"];
        for (const name of order) {
          const start = performance.now();
          const scanner = implementations[name].createStructuredStream({ snapshots });
          let state;
          try {
            for (const chunk of chunks) state = scanner.push(chunk);
          } finally {
            scanner.dispose();
          }
          const duration = performance.now() - start;
          assert.equal(state.complete, true);
          assert.deepEqual(state.partialValue, value);
          if (iteration >= warmups) timings[name].push(duration);
        }
      }
      const row = { snapshots, shape, bytes: Buffer.byteLength(input), chunkSize };
      for (const name of Object.keys(implementations)) {
        const sorted = timings[name].toSorted((a, b) => a - b);
        row[name] = { medianMs: sorted[10], p95Ms: sorted[18] };
      }
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("../artifacts/snapshots.json", import.meta.url), JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
  baselineEntry: resolve(baselineEntry), warmups, samples, rows,
}, null, 2) + "\n");
