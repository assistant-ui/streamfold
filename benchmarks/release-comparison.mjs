import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { cpus, release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parsePartialJson } from "ai";
import { parsePartialJsonObject } from "assistant-stream/utils";

const [beforeArgument, afterArgument] = process.argv.slice(2);
assert.ok(
  beforeArgument && afterArgument,
  "Pass baseline and candidate published src/index.js paths.",
);
const beforePath = resolve(beforeArgument);
const afterPath = resolve(afterArgument);
const metadata = (path) =>
  JSON.parse(
    readFileSync(join(dirname(dirname(path)), "package.json"), "utf8"),
  );
for (const path of [beforePath, afterPath]) {
  assert.ok(
    basename(path) === "index.js" && basename(dirname(path)) === "src",
    "Pass a published package's src/index.js entry.",
  );
  assert.equal(
    metadata(path).name,
    "streamfold",
    "Expected a Streamfold package.",
  );
}
const artifacts = fileURLToPath(new URL("../artifacts/", import.meta.url));
const output = resolve(
  process.env.STREAMFOLD_RELEASE_REPORT ??
    join(artifacts, "release-comparison.json"),
);
assert.ok(
  !existsSync(output),
  "Report already exists; set STREAMFOLD_RELEASE_REPORT to a new path to preserve earlier samples.",
);
mkdirSync(artifacts, { recursive: true });
const controlRoot = mkdtempSync(join(artifacts, "release-control-"));
cpSync(dirname(dirname(afterPath)), controlRoot, { recursive: true });
const controlPath = join(controlRoot, "src/index.js");
const [before, after, control] = await Promise.all(
  [beforePath, afterPath, controlPath].map(
    (path) => import(pathToFileURL(path).href),
  ),
);
const require = createRequire(import.meta.url);
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
assert.equal(hash(afterPath), hash(controlPath));
assert.notEqual(after.StructuredStreamPool, control.StructuredStreamPool);
const summarize = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samplesMs: values,
  };
};
const plain = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const records = (count) =>
  JSON.stringify({
    items: Array.from({ length: count }, (_, i) => ({
      id: `row-${i}`,
      city: "Paris",
      summary: "A clear morning with a cool evening.",
    })),
  });
const small = '{"city":"Paris"}';
const cases = [
  { name: "tiny / fragmented", text: small, chunkSize: 4, batch: 100 },
  { name: "tiny / one chunk", text: small, chunkSize: 4096, batch: 100 },
  {
    name: "10 records / 16 chars",
    text: records(10),
    chunkSize: 16,
    batch: 10,
  },
  {
    name: "10 records / 256 chars",
    text: records(10),
    chunkSize: 256,
    batch: 10,
  },
  {
    name: "600 records / 16 chars",
    text: records(600),
    chunkSize: 16,
    batch: 1,
  },
  {
    name: "600 records / 4096 chars",
    text: records(600),
    chunkSize: 4096,
    batch: 1,
  },
];
const warmups = 7;
const samples = 28;
const results = [];
const cores = {
  before: [before, "live"],
  afterLive: [after, "live"],
  controlLive: [control, "live"],
  afterImmutable: [after, "immutable"],
  controlImmutable: [control, "immutable"],
};
const orderFor = (names, round) => {
  const offset = ((round % names.length) + names.length) % names.length;
  const order = [...names.slice(offset), ...names.slice(0, offset)];
  return round % 2 === 0 ? order : order.reverse();
};

for (const scenario of cases) {
  const chunks = [];
  for (let i = 0; i < scenario.text.length; i += scenario.chunkSize)
    chunks.push(scenario.text.slice(i, i + scenario.chunkSize));
  const expected = JSON.parse(scenario.text);
  const pools = Object.fromEntries(
    Object.entries(cores).map(([name, [core, snapshots]]) => [
      name,
      new core.StructuredStreamPool({ snapshots }),
    ]),
  );
  for (const pool of Object.values(pools)) pool.start("check");
  let text = "";
  let retained;
  let retainedCopy;
  for (const delta of chunks) {
    text += delta;
    const values = Object.fromEntries(
      Object.entries(pools).map(([name, pool]) => [
        name,
        pool.push("check", delta).partialValue,
      ]),
    );
    for (const [name, value] of Object.entries(values))
      assert.deepEqual(
        plain(value),
        plain(values.afterLive),
        `${scenario.name}: ${name} prefix`,
      );
    assert.deepEqual(
      plain(parsePartialJsonObject(text)),
      plain(values.afterLive),
      `${scenario.name}: assistant prefix`,
    );
    assert.deepEqual(
      plain((await parsePartialJson(text)).value),
      plain(values.afterLive),
      `${scenario.name}: Vercel prefix`,
    );
    if (retained === undefined && values.afterImmutable !== undefined) {
      retained = values.afterImmutable;
      retainedCopy = plain(retained);
    }
  }
  assert.deepEqual(
    plain(retained),
    retainedCopy,
    "immutable earlier snapshot changed",
  );
  for (const pool of Object.values(pools)) {
    assert.deepEqual(pool.finish("check").value, expected);
    assert.equal(pool.size, 0);
  }
  const runners = Object.fromEntries(
    Object.entries(cores).map(([name, [core, snapshots]]) => [
      name,
      () => {
        const pool = new core.StructuredStreamPool({ snapshots });
        pool.start("timed");
        for (const delta of chunks) pool.push("timed", delta);
        return pool.finish("timed").value;
      },
    ]),
  );
  runners.assistant = () => {
    let input = "",
      value;
    for (const delta of chunks) {
      input += delta;
      value = parsePartialJsonObject(input);
    }
    return value;
  };
  runners.vercel = async () => {
    let input = "",
      value;
    for (const delta of chunks) {
      input += delta;
      value = (await parsePartialJson(input)).value;
    }
    return value;
  };
  const names = Object.keys(runners);
  const times = Object.fromEntries(names.map((name) => [name, []]));
  globalThis.gc?.();
  for (let round = -warmups; round < samples; round++) {
    for (const name of orderFor(names, round)) {
      let value;
      const started = performance.now();
      for (let i = 0; i < scenario.batch; i++) value = await runners[name]();
      const elapsed = (performance.now() - started) / scenario.batch;
      assert.deepEqual(
        plain(value),
        expected,
        `${scenario.name}: ${name} final`,
      );
      if (round >= 0) times[name].push(elapsed);
    }
  }
  results.push({
    name: scenario.name,
    bytes: Buffer.byteLength(scenario.text),
    chunkSize: scenario.chunkSize,
    chunks: chunks.length,
    batch: scenario.batch,
    measurements: Object.fromEntries(
      names.map((name) => [name, summarize(times[name])]),
    ),
  });
  console.log(JSON.stringify(results.at(-1)));
}

const cold = Object.fromEntries(
  ["before", "after", "control"].map((name) => [name, []]),
);
const coldPaths = {
  before: beforePath,
  after: afterPath,
  control: controlPath,
};
const worker = fileURLToPath(
  new URL("./cold-start-worker.mjs", import.meta.url),
);
for (let round = 0; round < 21; round++) {
  for (const name of orderFor(Object.keys(cold), round)) {
    cold[name].push(
      JSON.parse(
        execFileSync(process.execPath, [worker, coldPaths[name]], {
          encoding: "utf8",
        }),
      ),
    );
  }
}
const coldResults = Object.fromEntries(
  Object.entries(cold).map(([name, rows]) => [
    name,
    {
      import: summarize(rows.map((r) => r.importMs)),
      firstStream: summarize(rows.map((r) => r.firstStreamMs)),
      total: summarize(rows.map((r) => r.totalMs)),
    },
  ]),
);
const assistantPath = require.resolve("assistant-stream/utils");
const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    osRelease: release(),
    cpu: cpus()[0]?.model,
    before: metadata(beforePath).version,
    after: metadata(afterPath).version,
    assistantStream: JSON.parse(
      readFileSync(
        new URL("../package.json", pathToFileURL(assistantPath)),
        "utf8",
      ),
    ).version,
    vercelAI: require("ai/package.json").version,
  },
  inputs: {
    beforePath,
    afterPath,
    controlPath,
    beforeEntrySha256: hash(beforePath),
    afterEntrySha256: hash(afterPath),
  },
  methodology: {
    warmups,
    samples,
    coldSamples: 21,
    coldWarmups: 0,
    order:
      "Rotate all seven implementations and reverse every other round; independent identical candidate copy provides live and immutable A/A controls.",
    correctness:
      "Every partial JSON value matches across all seven paths before timing. Final values match JSON.parse after every timed batch; no assertions are timed.",
    scope:
      "Core pool setup, incremental parsing, materialization and finish, or real SDK accumulated-prefix parsing. Includes await per replay, and per Vercel delta. No SDK event adapter, network, SSE, React, validation or execution.",
    cold: "Fresh Node process per sample; import and first complete 16-byte stream separately timed. Excludes Node process startup; OS filesystem caches may be warm.",
    discardedSamples: 0,
  },
  results,
  cold: coldResults,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved ${output}; no measured samples discarded.`);
