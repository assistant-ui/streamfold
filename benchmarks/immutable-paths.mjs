import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as current from "streamfold";

const baselineEntry = process.argv[2];
if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
const baseline = await import(pathToFileURL(resolve(baselineEntry)));
const libs = { baseline, control: baseline, current };
const names = Object.keys(libs);
await Promise.all([baseline.prepareStreamfold(), current.prepareStreamfold()]);
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
if (process.argv.includes("--allocations")) {
  const rows = [];
  for (const snapshots of ["live", "immutable"])
    for (const length of [10, 100, 1000]) {
      const expected = Array.from({ length }, (_, i) => i),
        text = JSON.stringify(expected),
        counts = {};
      for (const name of names) {
        counts[name] = [];
        for (let trial = 0; trial < 3; trial++) {
          const scanner = libs[name].createStructuredStream({ snapshots });
          const original = Array.prototype.slice;
          let calls = 0,
            update;
          Array.prototype.slice = function (...args) {
            calls++;
            return Reflect.apply(original, this, args);
          };
          try {
            update = scanner.push(text);
          } finally {
            Array.prototype.slice = original;
          }
          try {
            assert.deepEqual(update.partialValue, expected);
            assert.deepEqual(scanner.finish().partialValue, expected);
          } finally {
            scanner.dispose();
          }
          counts[name].push(calls);
        }
      }
      assert.deepEqual(counts.baseline, counts.control);
      assert.deepEqual(counts.current, [0, 0, 0]);
      rows.push({ snapshots, length, counts });
    }
  writeFileSync(
    new URL("../artifacts/immutable-path-allocations.json", import.meta.url),
    JSON.stringify(
      { node: process.version, baselineEntry: resolve(baselineEntry), rows },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(rows));
  process.exit(0);
}
const permutations = [
  [0, 1, 2],
  [2, 1, 0],
  [1, 2, 0],
  [0, 2, 1],
  [2, 0, 1],
  [1, 0, 2],
];
const warmups = 12,
  samples = 31,
  batch = 10;
const fixtures = [
  ["array-1000", Array.from({ length: 1000 }, (_, i) => i)],
  [
    "nested-250",
    Array.from({ length: 250 }, (_, i) => ({
      id: i,
      data: { active: i % 2 === 0, label: `item ${i}` },
    })),
  ],
  ["root-string", "a short ordinary string"],
];
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const rows = [];
for (const [fixture, expected] of fixtures)
  for (const snapshots of ["live", "immutable"])
    for (const chunkSize of [Infinity, 512]) {
      if (fixture === "root-string" && chunkSize !== Infinity) continue;
      const text = JSON.stringify(expected),
        chunks = [];
      for (let offset = 0; offset < text.length; offset += chunkSize)
        chunks.push(text.slice(offset, offset + chunkSize));
      const traces = {};
      for (const name of names) {
        const scanner = libs[name].createStructuredStream({ snapshots });
        try {
          traces[name] = chunks.map((chunk) => structuredClone(scanner.push(chunk)));
          traces[name].push(structuredClone(scanner.finish()));
        } finally {
          scanner.dispose();
        }
        assert.deepEqual(traces[name].at(-1).partialValue, expected);
      }
      assert.deepEqual(traces.control, traces.baseline);
      assert.deepEqual(traces["current"], traces.baseline);
      const run = (name) => {
        let value;
        const start = performance.now();
        for (let n = 0; n < batch; n++) {
          const scanner = libs[name].createStructuredStream({ snapshots });
          try {
            for (const chunk of chunks) scanner.push(chunk);
            value = scanner.finish().partialValue;
          } finally {
            scanner.dispose();
          }
        }
        const elapsed = (performance.now() - start) / batch;
        assert.deepEqual(value, expected);
        return elapsed;
      };
      for (let n = 0; n < warmups; n++) for (const index of permutations[n % 6]) run(names[index]);
      const raw = Object.fromEntries(names.map((name) => [name, []]));
      for (let n = 0; n < samples; n++)
        for (const index of permutations[n % 6]) raw[names[index]].push(run(names[index]));
      const stats = Object.fromEntries(
        names.map((name) => [
          name,
          { medianMs: quantile(raw[name], 0.5), p95Ms: quantile(raw[name], 0.95) },
        ]),
      );
      const change = (name) => 100 * (stats[name].medianMs / stats.baseline.medianMs - 1);
      const row = {
        fixture,
        snapshots,
        chunkSize: chunkSize === Infinity ? "whole" : chunkSize,
        bytes: Buffer.byteLength(text),
        chunks: chunks.length,
        stats,
        aaMedianChangePct: change("control"),
        abMedianChangePct: change("current"),
        raw,
      };
      rows.push(row);
      console.log(JSON.stringify({ ...row, raw: undefined }));
    }
writeFileSync(
  new URL("../artifacts/immutable-paths.json", import.meta.url),
  JSON.stringify(
    {
      baselineEntry: resolve(baselineEntry),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      os: os.release(),
      cpu: os.cpus()[0].model,
      warmups,
      samples,
      batch,
      method:
        "Six rotating A/A/B orders; no allocation instrumentation; correctness outside timing; per-operation milliseconds.",
      rows,
    },
    null,
    2,
  ) + "\n",
);
