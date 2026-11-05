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
const fixtures = [[8, 64], [32768, 64], [32768, 1000]].map(([digits, emptyDeltas]) => {
  const text = '{"value":0.' + "1".repeat(digits) + "}";
  return {
    name: `fraction-${digits}-${emptyDeltas}-empty`, text, emptyDeltas,
    chunks: [text.slice(0, -1), ...Array(emptyDeltas).fill(""), "}"],
  };
});
const text = JSON.stringify({ value: "hello world ".repeat(400) });
fixtures.push({
  name: "ordinary-string-control", text, emptyDeltas: 0, chunkSize: 16,
  chunks: Array.from({ length: Math.ceil(text.length / 16) }, (_, index) => text.slice(index * 16, (index + 1) * 16)),
});
const warmups = 10;
const samples = 31;
const batch = 10;
const rows = [];
for (const fixture of fixtures) {
  const expected = JSON.parse(fixture.text);
  for (const snapshots of ["live", "immutable"]) {
    const left = baseline.createStructuredStream({ snapshots });
    const right = current.createStructuredStream({ snapshots });
    try {
      for (const chunk of fixture.chunks) {
        assert.deepEqual(right.push(chunk), left.push(chunk));
        assert.equal(right.getFieldState(["value"]), left.getFieldState(["value"]));
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
            for (const chunk of fixture.chunks) scanner.push(chunk);
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
    const row = { name: fixture.name, snapshots, bytes: Buffer.byteLength(fixture.text), chunks: fixture.chunks.length, emptyDeltas: fixture.emptyDeltas, chunkSize: fixture.chunkSize };
    for (const name of Object.keys(implementations)) {
      const sorted = timings[name].toSorted((a, b) => a - b);
      row[name] = { medianMs: sorted[15], p95Ms: sorted[29] };
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("../artifacts/empty-deltas.json", import.meta.url), JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
  baselineEntry: resolve(baselineEntry), warmups, samples, batch, rows,
}, null, 2) + "\n");
