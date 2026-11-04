import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as current from "streamfold";

const baselineEntry = process.argv[2];
if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
const baseline = await import(pathToFileURL(resolve(baselineEntry)));
await baseline.prepareStreamfold();
await current.prepareStreamfold();
const implementations = { baseline, current };
const fixtures = [
  ...[4096, 8192, 16384, 32768].map((digits) => ({
    name: `fraction-${digits}`, text: '{"n":0.' + "1".repeat(digits) + "}",
  })),
  {
    name: "ordinary-records",
    text: JSON.stringify({ rows: Array.from({ length: 400 }, (_, id) => ({ id, value: id / 7, count: id * 10 })) }),
  },
];
const rows = [];
for (const { name, text } of fixtures) {
  const warmups = name === "ordinary-records" ? 20 : 3;
  const samples = name === "ordinary-records" ? 30 : 10;
  const batch = name === "ordinary-records" ? 10 : 1;
  for (const chunkSize of [16, 512]) {
    for (const snapshots of ["live", "immutable"]) {
      const chunks = [];
      for (let offset = 0; offset < text.length; offset += chunkSize)
        chunks.push(text.slice(offset, offset + chunkSize));
      const expected = JSON.parse(text);
      const left = baseline.createStructuredStream({ snapshots });
      const right = current.createStructuredStream({ snapshots });
      try {
        for (const chunk of chunks) {
          assert.deepEqual(right.push(chunk), left.push(chunk));
          assert.equal(right.getFieldState(["n"]), left.getFieldState(["n"]));
        }
        assert.deepEqual(left.finish().partialValue, expected);
        assert.deepEqual(right.finish().partialValue, expected);
      } finally {
        left.dispose();
        right.dispose();
      }
      const timings = { baseline: [], current: [] };
      for (let trial = 0; trial < warmups + samples; trial++) {
        for (const implementation of trial % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
          let value;
          const start = performance.now();
          for (let repeat = 0; repeat < batch; repeat++) {
            const stream = implementations[implementation].createStructuredStream({ snapshots });
            try {
              for (const chunk of chunks) stream.push(chunk);
              value = stream.finish().partialValue;
            } finally {
              stream.dispose();
            }
          }
          const duration = (performance.now() - start) / batch;
          assert.deepEqual(value, expected);
          if (trial >= warmups) timings[implementation].push(duration);
        }
      }
      const row = { name, bytes: Buffer.byteLength(text), chunkSize, snapshots, warmups, samples, batch };
      for (const implementation of Object.keys(implementations)) {
        const sorted = timings[implementation].sort((a, b) => a - b);
        row[implementation] = { medianMs: sorted[Math.floor(samples / 2)], p95Ms: sorted[Math.ceil(samples * 0.95) - 1] };
      }
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("../artifacts/streamed-numbers.json", import.meta.url), JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
  baselineEntry: resolve(baselineEntry), rows,
}, null, 2) + "\n");
