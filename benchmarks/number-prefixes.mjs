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
const warmups = 3;
const samples = 10;
const rows = [];

for (const n of [8000, 16000, 32000]) {
  for (const invalid of [false, true]) {
    const input = "1" + "0".repeat(n) + (invalid ? "e" : "0").repeat(n);
    const timings = { baseline: [], current: [] };
    for (let iteration = 0; iteration < warmups + samples; iteration++) {
      const order = iteration % 2 ? ["current", "baseline"] : ["baseline", "current"];
      for (const name of order) {
        const scanner = implementations[name].createStructuredStream();
        try {
          const start = performance.now();
          const update = scanner.push(input);
          const duration = performance.now() - start;
          assert.equal(update.partialValue, Infinity);
          if (invalid) assert.throws(() => scanner.finish(), { code: "INVALID_JSON" });
          else assert.equal(scanner.finish().partialValue, JSON.parse(input));
          if (iteration >= warmups) timings[name].push(duration);
        } finally {
          scanner.dispose();
        }
      }
    }
    const row = { shape: invalid ? "repeated-exponents" : "valid-integer", bytes: input.length, chunkSize: input.length };
    for (const name of Object.keys(implementations)) {
      const sorted = timings[name].toSorted((a, b) => a - b);
      row[name] = { medianMs: sorted[5], p95Ms: sorted[9] };
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}

mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("../artifacts/number-prefixes.json", import.meta.url), JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model },
  baselineEntry: resolve(baselineEntry), warmups, samples, rows,
}, null, 2) + "\n");
