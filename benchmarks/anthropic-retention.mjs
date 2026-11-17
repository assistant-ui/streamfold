import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const worker = async (entry, cleared) => {
  const url = pathToFileURL(resolve(entry));
  const { createStructuredStreamPool } = await import(url);
  const { anthropic } = await import(new URL("./anthropic.js", url));
  const failSession = (count, bytes) => {
    const pool = createStructuredStreamPool();
    const session = anthropic(pool);
    for (let index = 0; index < count; index++) {
      session.push({
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: String(index),
          input: { text: "x".repeat(bytes) },
        },
      });
      if (cleared)
        session.push({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: "{}" },
        });
    }
    let failure;
    assert.throws(
      () => session.push({ type: "error", error: { message: "provider failed" } }),
      (error) => {
        failure = error;
        return error.message === "provider failed";
      },
    );
    assert.equal(pool.size, 0);
    assert.throws(
      () => session.finish(),
      (error) => error === failure,
    );
    return session;
  };
  const heap = async () => {
    for (let index = 0; index < 4; index++) {
      await setImmediate();
      globalThis.gc();
    }
    return process.memoryUsage().heapUsed;
  };
  failSession(1, 1);
  const before = await heap();
  const retained = failSession(8, 1024 * 1024);
  const retainedHeapBytes = (await heap()) - before;
  assert.equal(typeof retained.pushAll, "function");
  return { retainedHeapBytes };
};

if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(await worker(process.argv[3], process.argv[4] === "cleared")));
} else {
  if (!process.argv[2]) throw new Error("Pass the baseline package's src/index.js path");
  const entries = {
    baseline: resolve(process.argv[2]),
    control: resolve(process.argv[2]),
    current: fileURLToPath(new URL("../packages/core/src/index.js", import.meta.url)),
  };
  const measurements = [],
    results = [];
  for (const scenario of ["retained", "cleared"]) {
    for (let trial = 0; trial < 3; trial++) {
      for (const implementation of trial % 2
        ? ["current", "control", "baseline"]
        : ["baseline", "control", "current"]) {
        const observation = JSON.parse(
          execFileSync(
            process.execPath,
            [
              "--expose-gc",
              fileURLToPath(import.meta.url),
              "--worker",
              entries[implementation],
              scenario,
            ],
            { encoding: "utf8" },
          ),
        );
        measurements.push({ implementation, scenario, trial, ...observation });
      }
    }
    const row = { scenario };
    for (const implementation of Object.keys(entries)) {
      const samples = measurements
        .filter((value) => value.scenario === scenario && value.implementation === implementation)
        .map((value) => value.retainedHeapBytes)
        .sort((a, b) => a - b);
      row[implementation] = { medianHeapBytes: samples[1], p95HeapBytes: samples[2] };
    }
    results.push(row);
    console.log(JSON.stringify(row));
  }
  mkdirSync(new URL("../artifacts/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("../artifacts/anthropic-retention.json", import.meta.url),
    JSON.stringify(
      {
        environment: {
          node: process.version,
          cpu: cpus()[0].model,
          platform: process.platform,
          arch: process.arch,
        },
        entries,
        trials: 3,
        warmups: 1,
        calls: 8,
        initialTextBytes: 1024 * 1024,
        method:
          "Fresh process per observation; explicit GC; alternating A/control/B order; repeated baseline control; no discarded samples. Retained JavaScript heap, not RSS, Wasm memory, or elapsed time.",
        results,
        measurements,
      },
      null,
      2,
    ) + "\n",
  );
}
