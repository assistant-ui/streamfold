import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { fixtureEvents } from "../src/fixtures.ts";
import { runParser } from "../src/parser-benchmark.ts";

// Match the demo's parser settings, including partial immutable snapshots.
// Keep fixture generation, assertions, UI, validation, and delays out of timing.
const runBaseline = (events) => runParser("without", events);
const runStreamfold = (events) => runParser("with", events);

function largeEvents(targetBytes, chunkSize) {
  const rows = [];
  let text = "";
  while (text.length < targetBytes) {
    rows.push({
      id: rows.length,
      title: `Forecast location ${rows.length}`,
      hours: [13, 14, 16, 18, 20, 19, 17, 15],
      summary: "Cool mornings, a warmer afternoon, and a breezy waterfront.",
    });
    text = JSON.stringify({ locations: rows });
  }
  const events = [
    {
      type: "part-start",
      path: [0],
      part: {
        type: "tool-call",
        toolCallId: "large-1",
        toolName: "show_forecast",
      },
    },
  ];
  for (let offset = 0; offset < text.length; offset += chunkSize)
    events.push({
      type: "text-delta",
      path: [0],
      textDelta: text.slice(offset, offset + chunkSize),
    });
  events.push({ type: "tool-call-args-text-finish", path: [0] });
  return events;
}

function expectedValues(events) {
  const texts = new Map();
  for (const event of events) {
    const key = event.path.join("/");
    if (event.type === "part-start") texts.set(key, "");
    if (event.type === "text-delta")
      texts.set(key, texts.get(key) + event.textDelta);
  }
  return [...texts.values()].map((text) => JSON.parse(text));
}

const cases = [
  { name: "Weather fixture", events: fixtureEvents("weather"), batch: 40 },
  { name: "Complex trip fixture", events: fixtureEvents("trip"), batch: 20 },
  {
    name: "4 KB nested JSON / 32-char chunks",
    events: largeEvents(4_000, 32),
    batch: 4,
  },
  {
    name: "48 KB nested JSON / 32-char chunks",
    events: largeEvents(48_000, 32),
    batch: 1,
  },
  {
    name: "48 KB nested JSON / 256-char chunks",
    events: largeEvents(48_000, 256),
    batch: 1,
  },
];
const runners = { baseline: runBaseline, streamfold: runStreamfold };
const warmups = 5;
const samples = 25;
const results = [];
let consumedValues = 0;

for (const { name, events, batch } of cases) {
  const expected = expectedValues(events);
  for (const run of Object.values(runners)) {
    // Remove assistant-stream's symbol metadata when comparing JSON values.
    assert.deepEqual(JSON.parse(JSON.stringify(run(events))), expected);
  }
  const timings = { baseline: [], streamfold: [] };
  for (let sample = -warmups; sample < samples; sample++) {
    // Alternate order to avoid always giving one implementation the warm CPU.
    const order =
      sample % 2 === 0
        ? ["baseline", "streamfold"]
        : ["streamfold", "baseline"];
    for (const side of order) {
      const started = performance.now();
      for (let i = 0; i < batch; i++)
        consumedValues += runners[side](events).length;
      const elapsed = (performance.now() - started) / batch;
      if (sample >= 0) timings[side].push(elapsed);
    }
  }
  const summarize = (values) => {
    const sorted = values.toSorted((a, b) => a - b);
    return {
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
  };
  const baseline = summarize(timings.baseline);
  const streamfold = summarize(timings.streamfold);
  results.push({
    name,
    bytes: events.reduce(
      (sum, event) =>
        sum +
        (event.type === "text-delta" ? Buffer.byteLength(event.textDelta) : 0),
      0,
    ),
    deltaEvents: events.filter((event) => event.type === "text-delta").length,
    batch,
    baseline,
    streamfold,
    baselineOverStreamfold: baseline.medianMs / streamfold.medianMs,
  });
}

assert.ok(consumedValues > 0);
const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: cpus()[0]?.model,
    streamfold: lock.packages["node_modules/streamfold"].version,
    assistantStream: lock.packages["node_modules/assistant-stream"].version,
  },
  methodology: {
    scope:
      "Elapsed milliseconds per complete argument stream, including parser/adapter setup, event dispatch, partial values, accumulated argsText, and finalization. Streamfold uses immutable snapshots as in the demo. No timers, React rendering, validation, tool execution, model, or network latency. This is not an assistant-ui end-to-end benchmark or an internal-reader replacement.",
    sampling: `${warmups} warmup batches and ${samples} measured batches per parser; alternating order; each batch averaged per stream. Final JSON values checked against JSON.parse before timing. First import/WASM initialization excluded.`,
  },
  results,
};
const output = new URL(
  "../../../artifacts/assistant-ui-demo/parser-timing-results.json",
  import.meta.url,
);
mkdirSync(new URL(".", output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(report.environment);
console.table(
  results.map((result) => ({
    scenario: result.name,
    bytes: result.bytes,
    deltas: result.deltaEvents,
    "baseline ms": result.baseline.medianMs.toFixed(3),
    "Streamfold ms": result.streamfold.medianMs.toFixed(3),
    "baseline / Streamfold": `${result.baselineOverStreamfold.toFixed(2)}x`,
  })),
);
console.log(
  "Median processing time per stream, not total response time. Ratios below 1 mean Streamfold was slower.",
);
console.log(`Report: ${output.pathname}`);
