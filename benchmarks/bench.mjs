import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  IncrementalJsonScanner,
  STREAMFOLD_ENGINE,
} from "../packages/core/src/index.js";
import { JavaScriptIncrementalScanner } from "./javascript-scanner.mjs";
import { repairAndParse } from "./repair-and-parse.mjs";

const payload = (targetSize) => {
  const items = [];
  const count = Math.max(1, Math.floor(targetSize / 72));
  for (let index = 0; index < count; index++) {
    items.push({
      id: index,
      name: `record-${index}`,
      enabled: true,
      tags: ["alpha", "beta"],
    });
  }
  return JSON.stringify({
    tool: "write_records",
    items,
    metadata: { source: "benchmark", nested: { depth: 3 } },
  });
};

const percentile = (values, ratio) => {
  const ordered = values.toSorted((a, b) => a - b);
  return ordered[Math.round((ordered.length - 1) * ratio)];
};

const measure = (implementation, data, chunkSize, iterations, run) => {
  const samples = [];
  for (let iteration = 0; iteration < iterations + 3; iteration++) {
    const started = performance.now();
    run();
    const elapsed = performance.now() - started;
    if (iteration >= 3) samples.push(elapsed);
  }
  return {
    implementation,
    bytes: Buffer.byteLength(data),
    chunkSize,
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    iterations,
  };
};

const results = [];
const sizes = [1_000, 10_000, 50_000];
const chunkSizes = [16, 256, 4096];

for (const targetSize of sizes) {
  const data = payload(targetSize);
  for (const chunkSize of chunkSizes) {
    const chunks = [];
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      chunks.push(data.slice(offset, offset + chunkSize));
    }

    const baselineIterations =
      data.length > 20_000 && chunkSize <= 16 ? 5 : data.length > 5_000 ? 6 : 20;
    results.push(
      measure("repair-and-reparse", data, chunkSize, baselineIterations, () => {
        let accumulated = "";
        for (const chunk of chunks) {
          accumulated += chunk;
          repairAndParse(accumulated);
        }
      }),
    );
    results.at(-1).charactersVisited = chunks.reduce(
      (total, _, index) =>
        total + Math.min((index + 1) * chunkSize, data.length),
      0,
    );

    const incrementalIterations = data.length > 20_000 ? 30 : 60;
    results.push(
      measure("javascript-reference", data, chunkSize, incrementalIterations, () => {
        const scanner = new JavaScriptIncrementalScanner();
        for (const chunk of chunks) scanner.push(chunk);
        if (!scanner.complete) throw new Error("incomplete result");
      }),
    );
    results.at(-1).charactersVisited = data.length;

    results.push(
      measure(`${STREAMFOLD_ENGINE}-npm`, data, chunkSize, incrementalIterations, () => {
        const scanner = new IncrementalJsonScanner();
        for (const chunk of chunks) scanner.push(chunk);
        if (!scanner.state.complete) throw new Error("incomplete result");
        scanner.dispose();
      }),
    );
    results.at(-1).charactersVisited = data.length;
  }
}

execFileSync("cargo", ["build", "--release", "-p", "streamfold-core"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
});
const rustOutput = execFileSync(
  fileURLToPath(new URL("../target/release/streamfold-bench", import.meta.url)),
  [],
  { encoding: "utf8" },
);
results.push(...JSON.parse(rustOutput));

mkdirSync(new URL("../artifacts", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../artifacts/benchmark-results.json", import.meta.url),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cpu: process.env.STREAMFOLD_CPU ?? "local machine",
      },
      methodology: {
        baseline:
          "Accumulate every chunk, repair incomplete containers, and JSON.parse the entire accumulated value after every chunk.",
        incremental:
          "Retain parser state in the published Rust/WASM npm implementation and visit each incoming UTF-8 byte exactly once. Timing includes UTF-8 encoding, memory copies, and every JavaScript-to-Wasm call.",
        javascriptReference:
          "Use the previous retained JavaScript scanner in benchmark-only code to isolate the cost of crossing the Wasm boundary.",
        note:
          "The prototype scanner validates structure and reports partial state; it does not yet materialize the complete partial object exposed by assistant-stream.",
      },
      results,
    },
    null,
    2,
  )}\n`,
);

const focus = results.filter(
  (row) => row.bytes > 40_000 && row.chunkSize === 16,
);
console.table(
  focus.map((row) => ({
    implementation: row.implementation,
    bytes: row.bytes,
    "median ms": row.medianMs.toFixed(3),
    "p95 ms": row.p95Ms.toFixed(3),
  })),
);
console.log("Wrote artifacts/benchmark-results.json");
