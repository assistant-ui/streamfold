import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [baselineEntry, controlEntry, candidateEntry] = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"));
if (!baselineEntry || !controlEntry) {
  throw new Error(
    "Pass baseline and independent identical control src/index.js paths; optionally pass a candidate path.",
  );
}
assert.notEqual(resolve(baselineEntry), resolve(controlEntry));
const load = (entry) => import(pathToFileURL(resolve(entry)));
const libs = {
  baseline: await load(baselineEntry),
  control: await load(controlEntry),
  candidate: candidateEntry ? await load(candidateEntry) : await import("streamfold"),
};
assert.notEqual(libs.baseline, libs.control, "Use independently loaded package copies.");
const names = Object.keys(libs);
await Promise.all(names.map((name) => libs[name].prepareStreamfold()));
const output = new URL("../artifacts/", import.meta.url);
mkdirSync(output, { recursive: true });
const fixtures = [
  ["object-string", JSON.stringify({ text: "abcdefgh".repeat(1000) }), 8, [["text"]]],
  ["array-string", JSON.stringify(["abcdefgh".repeat(1000)]), 8, [[0]]],
  [
    "nested-string",
    JSON.stringify({ rows: [{ nested: { text: "abcdefgh".repeat(1000) } }] }),
    8,
    [["rows", 0, "nested", "text"]],
  ],
  [
    "duplicate-key",
    `{${Array.from({ length: 1000 }, (_, i) => `"value":${i}`).join(",")}}`,
    Infinity,
    [["value"]],
  ],
  [
    "new-properties",
    JSON.stringify(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`key${i}`, i]))),
    Infinity,
    [["key0"], ["key999"]],
  ],
  [
    "new-array-items",
    JSON.stringify(Array.from({ length: 1000 }, (_, i) => i)),
    Infinity,
    [[0], [999]],
  ],
  ["root-string", JSON.stringify("abcdefgh".repeat(1000)), 8, [[]]],
];
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
  batch = 6;
const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const countDefinitions = process.argv.includes("--definitions");
const rows = [];
for (const [fixture, text, chunkSize, paths] of fixtures) {
  const expected = JSON.parse(text),
    chunks = [];
  for (let offset = 0; offset < text.length; offset += chunkSize)
    chunks.push(text.slice(offset, offset + chunkSize));
  for (const snapshots of ["live", "immutable"]) {
    const traces = {};
    for (const name of names) {
      const scanner = libs[name].createStructuredStream({ snapshots });
      try {
        traces[name] = chunks.map((chunk) => ({
          update: structuredClone(scanner.push(chunk)),
          fields: paths.map((path) => scanner.getFieldState(path)),
        }));
        traces[name].push({
          update: structuredClone(scanner.finish()),
          fields: paths.map((path) => scanner.getFieldState(path)),
        });
        assert.deepEqual(traces[name].at(-1).update.partialValue, expected);
      } finally {
        scanner.dispose();
      }
    }
    assert.deepEqual(traces.control, traces.baseline);
    assert.deepEqual(traces.candidate, traces.baseline);
    if (countDefinitions) {
      const counts = {};
      for (const name of names) {
        counts[name] = [];
        for (let trial = 0; trial < 3; trial++) {
          const scanner = libs[name].createStructuredStream({ snapshots });
          const original = Object.defineProperty;
          let definitions = 0,
            value;
          Object.defineProperty = function (...args) {
            definitions++;
            return Reflect.apply(original, this, args);
          };
          try {
            for (const chunk of chunks) scanner.push(chunk);
            value = scanner.finish().partialValue;
          } finally {
            Object.defineProperty = original;
            scanner.dispose();
          }
          assert.deepEqual(value, expected);
          counts[name].push(definitions);
        }
      }
      assert.deepEqual(counts.baseline, counts.control);
      const row = { fixture, snapshots, chunks: chunks.length, counts };
      rows.push(row);
      console.log(JSON.stringify(row));
      continue;
    }
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
    for (let n = 0; n < warmups; n++)
      for (const index of permutations[n % permutations.length]) run(names[index]);
    const raw = Object.fromEntries(names.map((name) => [name, []]));
    for (let n = 0; n < samples; n++)
      for (const index of permutations[n % permutations.length])
        raw[names[index]].push(run(names[index]));
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
      bytes: Buffer.byteLength(text),
      chunks: chunks.length,
      chunkSize: chunkSize === Infinity ? "whole" : chunkSize,
      stats,
      aaMedianChangePct: change("control"),
      abMedianChangePct: change("candidate"),
      raw,
    };
    rows.push(row);
    console.log(JSON.stringify({ ...row, raw: undefined }));
  }
}
writeFileSync(
  new URL(countDefinitions ? "live-property-definitions.json" : "live-properties.json", output),
  JSON.stringify(
    {
      baselineEntry: resolve(baselineEntry),
      controlEntry: resolve(controlEntry),
      candidateEntry: candidateEntry ? resolve(candidateEntry) : "workspace streamfold",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      os: os.release(),
      cpu: os.cpus()[0].model,
      warmups: countDefinitions ? 0 : warmups,
      samples: countDefinitions ? 3 : samples,
      batch: countDefinitions ? 1 : batch,
      method: countDefinitions
        ? "Object.defineProperty calls counted in a separate process; not heap allocations or timings."
        : "Six rotating A/control/B orders; independent identical control module; correctness outside timing; per-operation milliseconds; no samples discarded.",
      rows,
    },
    null,
    2,
  ) + "\n",
);
