import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import * as current from "streamfold";

const baselineEntry = process.argv[2];
if (!baselineEntry) throw new Error("Pass the baseline package's src/index.js path");
const baseline = await import(pathToFileURL(resolve(baselineEntry)));
const implementations = { baseline, control: baseline, current };
const names = Object.keys(implementations);
await Promise.all([baseline.prepareStreamfold(), current.prepareStreamfold()]);
mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
const environment = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  os: os.release(),
  cpu: os.cpus()[0].model,
};
const adapters = Object.fromEntries(
  names.map((name) => [name, implementations[name].defineAdapter((event) => event)]),
);
const sources = {
  array: (events) => events,
  async: async function* (events) {
    yield* events;
  },
  reader: (events) => {
    const source = new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(event);
        controller.close();
      },
    });
    Object.defineProperty(source, Symbol.asyncIterator, { value: undefined });
    return source;
  },
};
const consume = async (name, source, signal, capture = false) => {
  let count = 0,
    completed;
  const updates = [];
  for await (const update of implementations[name].readStructured(source, {
    adapter: adapters[name],
    signal,
  })) {
    count++;
    if (capture) updates.push(structuredClone(update));
    if (update.type === "complete") completed = update.value;
  }
  return { count, completed, updates };
};
if (process.argv.includes("--allocations")) {
  const rows = [];
  for (const length of [10, 100, 1000])
    for (const signalled of [false, true]) {
      const events = Array.from({ length }, () => []),
        counts = {};
      for (const name of names) {
        counts[name] = [];
        for (let trial = 0; trial < 3; trial++) {
          const signal = signalled ? new AbortController().signal : undefined;
          let promises = 0,
            result;
          const hook = createHook({
            init(_id, type) {
              if (type === "PROMISE") promises++;
            },
          });
          hook.enable();
          try {
            result = await consume(name, events, signal);
          } finally {
            hook.disable();
          }
          assert.equal(result.count, 0);
          counts[name].push(promises);
        }
      }
      assert.deepEqual(counts.baseline, counts.control);
      if (signalled) assert.deepEqual(counts.current, counts.baseline);
      else assert.equal(counts.baseline[0] - counts.current[0], 3 * (length + 1));
      rows.push({ events: length, signalled, counts });
    }
  writeFileSync(
    new URL("../artifacts/managed-read-allocations.json", import.meta.url),
    JSON.stringify({ environment, baselineEntry: resolve(baselineEntry), rows }, null, 2) + "\n",
  );
  console.log(JSON.stringify(rows));
  process.exit(0);
}
const expected = { text: "hello ".repeat(500) },
  text = JSON.stringify(expected),
  chunks = [];
for (let offset = 0; offset < text.length; offset += 16)
  chunks.push(text.slice(offset, offset + 16));
const fixtures = [
  {
    name: "ignored-1000",
    events: Array.from({ length: 1000 }, () => []),
    count: 0,
    value: undefined,
    bytes: 0,
  },
  {
    name: "tool-string",
    events: [
      [{ type: "start", id: "tool" }],
      ...chunks.map((text) => [{ type: "delta", id: "tool", text }]),
      [{ type: "end", id: "tool" }],
    ],
    count: chunks.length + 2,
    value: expected,
    bytes: Buffer.byteLength(text),
  },
];
const orders = [
  [0, 1, 2],
  [2, 1, 0],
  [1, 2, 0],
  [0, 2, 1],
  [2, 0, 1],
  [1, 0, 2],
];
const warmups = 12,
  samples = 31,
  batch = 5,
  rows = [];
const percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
for (const fixture of fixtures)
  for (const [sourceName, createSource] of Object.entries(sources))
    for (const signalled of [false, true]) {
      const traces = {};
      for (const name of names) {
        traces[name] = await consume(
          name,
          createSource(fixture.events),
          signalled ? new AbortController().signal : undefined,
          true,
        );
        assert.equal(traces[name].count, fixture.count);
        assert.deepEqual(traces[name].completed, fixture.value);
      }
      assert.deepEqual(traces.current, traces.baseline);
      assert.deepEqual(traces.control, traces.baseline);
      const raw = Object.fromEntries(names.map((name) => [name, []]));
      for (let trial = 0; trial < warmups + samples; trial++)
        for (const index of orders[trial % 6]) {
          const name = names[index];
          let duration = 0;
          for (let repeat = 0; repeat < batch; repeat++) {
            const source = createSource(fixture.events),
              signal = signalled ? new AbortController().signal : undefined;
            const start = performance.now();
            const result = await consume(name, source, signal);
            duration += performance.now() - start;
            assert.equal(result.count, fixture.count);
            assert.deepEqual(result.completed, fixture.value);
            if (sourceName === "reader") assert.equal(source.locked, false);
          }
          if (trial >= warmups) raw[name].push(duration / batch);
        }
      const stats = Object.fromEntries(
        names.map((name) => [
          name,
          { medianMs: percentile(raw[name], 0.5), p95Ms: percentile(raw[name], 0.95) },
        ]),
      );
      const row = {
        fixture: fixture.name,
        source: sourceName,
        signalled,
        events: fixture.events.length,
        bytes: fixture.bytes,
        chunkSize: fixture.bytes ? 16 : null,
        stats,
        aaMedianChangePct: 100 * (stats.control.medianMs / stats.baseline.medianMs - 1),
        abMedianChangePct: 100 * (stats.current.medianMs / stats.baseline.medianMs - 1),
        raw,
      };
      rows.push(row);
      console.log(JSON.stringify({ ...row, raw: undefined }));
    }
writeFileSync(
  new URL("../artifacts/managed-reads.json", import.meta.url),
  JSON.stringify(
    {
      environment,
      baselineEntry: resolve(baselineEntry),
      warmups,
      samples,
      batch,
      method:
        "Six rotating A/A/B orders; no allocation hooks; source construction and correctness checks outside timing; no samples discarded.",
      rows,
    },
    null,
    2,
  ) + "\n",
);
