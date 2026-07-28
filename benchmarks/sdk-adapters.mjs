import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { parsePartialJson } from "ai";
import { parsePartialJsonObject } from "assistant-stream/utils";
import { StructuredStreamPool } from "streamfold";
import { repairAndParse } from "./repair-and-parse.mjs";
import { createSdkCases, createToolInputs } from "./sdk-cases.mjs";

const require = createRequire(import.meta.url);
const aiSdkVersion = require("ai/package.json").version;
const assistantStreamEntry = require.resolve("assistant-stream/utils");
const assistantStreamVersion = JSON.parse(
  readFileSync(
    new URL("../package.json", pathToFileURL(assistantStreamEntry)),
    "utf8",
  ),
).version;
const streamfoldEntry = require.resolve("streamfold");
const streamfoldVersion = JSON.parse(
  readFileSync(
    new URL("../package.json", pathToFileURL(streamfoldEntry)),
    "utf8",
  ),
).version;

const percentile = (samples, ratio) => {
  const ordered = samples.toSorted((a, b) => a - b);
  return ordered[Math.round((ordered.length - 1) * ratio)];
};

const measure = (run, iterations = 200, warmups = 20) => {
  globalThis.gc?.();
  const samples = [];
  for (let iteration = 0; iteration < iterations + warmups; iteration++) {
    const started = performance.now();
    run();
    const elapsed = performance.now() - started;
    if (iteration >= warmups) samples.push(elapsed);
  }
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    minMs: Math.min(...samples),
    iterations,
  };
};

const measureAsync = async (run, iterations = 3, warmups = 1) => {
  globalThis.gc?.();
  const samples = [];
  for (let iteration = 0; iteration < iterations + warmups; iteration++) {
    const started = performance.now();
    await run();
    const elapsed = performance.now() - started;
    if (iteration >= warmups) samples.push(elapsed);
  }
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    minMs: Math.min(...samples),
    iterations,
  };
};

const runDirect = (inputs) => {
  const pool = new StructuredStreamPool();
  for (const input of inputs) pool.start(input.id);
  const rounds = Math.max(...inputs.map((input) => input.chunks.length));
  for (let round = 0; round < rounds; round++) {
    for (const input of inputs) {
      const delta = input.chunks[round];
      if (delta !== undefined) pool.push(input.id, delta);
    }
  }
  const results = inputs.map((input) => pool.finish(input.id));
  if (results.length !== inputs.length) throw new Error("missing direct result");
};

const runAdapter = (sdkCase, inputCount) => {
  const pool = new StructuredStreamPool();
  const adapter = sdkCase.createAdapter(pool);
  for (const event of sdkCase.events) adapter.push(event);
  const results = adapter.finish();
  if (results.length !== inputCount) {
    throw new Error(`${sdkCase.name} returned ${results.length} results`);
  }
};

const scenarios = [
  { name: "one 48 KB tool call", calls: 1, targetBytes: 48_000, chunkSize: 16 },
  {
    name: "eight concurrent 12 KB tool calls",
    calls: 8,
    targetBytes: 96_000,
    chunkSize: 32,
  },
];
const results = [];

for (const scenario of scenarios) {
  const inputs = createToolInputs(scenario);
  const bytes = inputs.reduce((total, input) => total + input.text.length, 0);
  const eventCount = inputs.reduce(
    (total, input) => total + input.chunks.length,
    0,
  );
  const direct = measure(() => runDirect(inputs));
  results.push({
    scenario: scenario.name,
    implementation: "direct streamfold",
    bytes,
    calls: scenario.calls,
    chunkSize: scenario.chunkSize,
    deltaEvents: eventCount,
    adapterOverheadUs: 0,
    ...direct,
  });

  for (const sdkCase of createSdkCases(inputs)) {
    const measurement = measure(() => runAdapter(sdkCase, inputs.length));
    results.push({
      scenario: scenario.name,
      implementation: sdkCase.name,
      bytes,
      calls: scenario.calls,
      chunkSize: scenario.chunkSize,
      deltaEvents: eventCount,
      adapterOverheadUs: (measurement.medianMs - direct.medianMs) * 1_000,
      ...measurement,
    });
  }
}

const baselineInputs = createToolInputs(scenarios[0]);
const baseline = measure(
  () => {
    for (const input of baselineInputs) {
      let accumulated = "";
      for (const chunk of input.chunks) {
        accumulated += chunk;
        repairAndParse(accumulated);
      }
    }
  },
  3,
  1,
);
results.push({
  scenario: scenarios[0].name,
  implementation: "repair + parse every delta",
  bytes: baselineInputs[0].text.length,
  calls: 1,
  chunkSize: scenarios[0].chunkSize,
  deltaEvents: baselineInputs[0].chunks.length,
  ...baseline,
});

const assistantStreamBaseline = measure(
  () => {
    for (const input of baselineInputs) {
      let accumulated = "";
      let finalValue;
      for (const chunk of input.chunks) {
        accumulated += chunk;
        finalValue = parsePartialJsonObject(accumulated);
      }
      if (JSON.stringify(finalValue) !== input.text) {
        throw new Error(
          "assistant-stream baseline produced a different final value",
        );
      }
    }
  },
  3,
  1,
);
results.push({
  scenario: scenarios[0].name,
  implementation: `assistant-stream ${assistantStreamVersion} parsePartialJsonObject`,
  bytes: baselineInputs[0].text.length,
  calls: 1,
  chunkSize: scenarios[0].chunkSize,
  deltaEvents: baselineInputs[0].chunks.length,
  ...assistantStreamBaseline,
});

const vercelBaseline = await measureAsync(async () => {
  for (const input of baselineInputs) {
    let accumulated = "";
    let finalValue;
    for (const chunk of input.chunks) {
      accumulated += chunk;
      finalValue = (await parsePartialJson(accumulated)).value;
    }
    if (JSON.stringify(finalValue) !== input.text) {
      throw new Error("Vercel AI SDK baseline produced a different final value");
    }
  }
});
results.push({
  scenario: scenarios[0].name,
  implementation: `Vercel AI SDK ${aiSdkVersion} parsePartialJson`,
  bytes: baselineInputs[0].text.length,
  calls: 1,
  chunkSize: scenarios[0].chunkSize,
  deltaEvents: baselineInputs[0].chunks.length,
  ...vercelBaseline,
});

const singleScenario = results.filter(
  (result) => result.scenario === scenarios[0].name,
);
const maxSingleAdapterOverheadUs = Math.max(
  ...singleScenario
    .map((result) => result.adapterOverheadUs)
    .filter((value) => value !== undefined),
);
const maxConcurrentAdapterOverheadUs = Math.max(
  ...results
    .filter((result) => result.scenario === scenarios[1].name)
    .map((result) => result.adapterOverheadUs),
);
const vercelUi = singleScenario.find(
  (result) => result.implementation === "Vercel AI SDK UIMessage",
);
const assistantUi = singleScenario.find(
  (result) => result.implementation === "assistant-stream",
);

const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    streamfold: streamfoldVersion,
    streamfoldSource:
      process.env.STREAMFOLD_BENCHMARK_SOURCE ?? "workspace",
    assistantStream: assistantStreamVersion,
    vercelAiSdk: aiSdkVersion,
  },
  methodology: {
    adapter:
      "Prebuilt, official-shaped SDK events are routed into one StructuredStreamPool. Timing includes event dispatch, ID lookup, retained scanning, one final join, and one final JSON.parse.",
    direct:
      "The same inputs are pushed directly into StructuredStreamPool without an SDK event envelope.",
    baseline:
      "The complete accumulated string is repaired and parsed after every delta. This isolates the repeated-work pattern used by partial-object materializers; it is not a claim about every SDK.",
    vercelBaseline:
      "The installed Vercel AI SDK parsePartialJson export is awaited on the complete accumulated input after every delta, matching the hot path in its UI message stream processor.",
    assistantStreamBaseline:
      "The installed assistant-stream parsePartialJsonObject export is called on the complete accumulated input after every delta, matching its tool-call accumulator.",
    scope:
      "No network or model latency is included. Adapters use structural event shapes and do not import provider SDK packages.",
  },
  summary: {
    maxSingleAdapterOverheadUs,
    maxConcurrentAdapterOverheadUs,
    vercelPartialParseOpportunityRatio:
      vercelBaseline.medianMs / vercelUi.medianMs,
    assistantStreamPartialParseOpportunityRatio:
      assistantStreamBaseline.medianMs / assistantUi.medianMs,
  },
  results,
};

mkdirSync(new URL("../artifacts", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../artifacts/sdk-adapter-results.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);

for (const scenario of scenarios) {
  console.log(`\n${scenario.name}`);
  console.table(
    results
      .filter((result) => result.scenario === scenario.name)
      .map((result) => ({
        implementation: result.implementation,
        "median ms": result.medianMs.toFixed(3),
        "p95 ms": result.p95Ms.toFixed(3),
        "adapter overhead µs":
          result.adapterOverheadUs === undefined
            ? "n/a"
            : result.adapterOverheadUs.toFixed(1),
      })),
  );
}
console.log("\nWrote artifacts/sdk-adapter-results.json");
