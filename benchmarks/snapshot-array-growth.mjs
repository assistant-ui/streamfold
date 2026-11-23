import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { createStructuredStream, prepareStreamfold } from "streamfold";

// Measures how immutable snapshots scale as one array grows during a stream.
// "live-control" repeats live mode in the same rotation as an A/A noise check.
await prepareStreamfold();

const itemCounts = [1000, 4000, 16000];
const chunkSizes = [8, 256];
const warmups = 5;
const samples = 20;
const entries = [
  ["live", "live"],
  ["immutable", "immutable"],
  ["live-control", "live"],
];
const fullParityLimit = 1000;

const percentile = (sorted, fraction) => sorted[Math.ceil(fraction * sorted.length) - 1];
const run = (snapshots, chunks) => {
  const scanner = createStructuredStream({ snapshots });
  let state;
  try {
    for (const chunk of chunks) state = scanner.push(chunk);
  } finally {
    scanner.dispose();
  }
  return state;
};

const rows = [];
for (const items of itemCounts) {
  const value = { items: Array.from({ length: items }, (_, id) => ({ id, name: `item ${id}` })) };
  const input = JSON.stringify(value);
  for (const chunkSize of chunkSizes) {
    const chunks = [];
    for (let offset = 0; offset < input.length; offset += chunkSize)
      chunks.push(input.slice(offset, offset + chunkSize));

    // Check partial-value parity outside the timed runs. Every prefix is compared
    // for small payloads; larger payloads compare every 997th prefix and the end.
    const probes = ["live", "immutable"].map((snapshots) => createStructuredStream({ snapshots }));
    try {
      chunks.forEach((chunk, index) => {
        const [live, immutable] = probes.map((probe) => probe.push(chunk));
        if (items <= fullParityLimit || index % 997 === 0 || index === chunks.length - 1)
          assert.deepEqual(immutable.partialValue, live.partialValue);
      });
    } finally {
      for (const probe of probes) probe.dispose();
    }

    const timings = Object.fromEntries(entries.map(([name]) => [name, []]));
    for (let iteration = 0; iteration < warmups + samples; iteration++) {
      for (let offset = 0; offset < entries.length; offset++) {
        const [name, snapshots] = entries[(iteration + offset) % entries.length];
        const start = performance.now();
        const state = run(snapshots, chunks);
        const duration = performance.now() - start;
        assert.equal(state.complete, true);
        assert.deepEqual(state.partialValue, value);
        if (iteration >= warmups) timings[name].push(duration);
      }
    }

    const row = { items, bytes: Buffer.byteLength(input), chunkSize, pushes: chunks.length };
    for (const [name] of entries) {
      const sorted = timings[name].toSorted((a, b) => a - b);
      row[name] = {
        medianMs: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        samplesMs: timings[name],
      };
    }
    row.immutableToLiveMedian = row.immutable.medianMs / row.live.medianMs;
    row.controlToLiveMedian = row["live-control"].medianMs / row.live.medianMs;
    rows.push(row);
    const format = (name) => `${row[name].medianMs.toFixed(1)}/${row[name].p95Ms.toFixed(1)}`;
    console.log(
      `${items} items, ${chunkSize}-byte chunks (${chunks.length} pushes): ` +
        `live ${format("live")} ms, immutable ${format("immutable")} ms, ` +
        `control ${format("live-control")} ms (median/p95), ` +
        `immutable ${row.immutableToLiveMedian.toFixed(2)}x, control ${row.controlToLiveMedian.toFixed(2)}x`,
    );
  }
}

const environment = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  cores: cpus().length,
  memoryBytes: totalmem(),
};
console.log(JSON.stringify(environment));
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../artifacts/snapshot-array-growth.json", import.meta.url),
  JSON.stringify({ environment, warmups, samples, rows }, null, 2) + "\n",
);
