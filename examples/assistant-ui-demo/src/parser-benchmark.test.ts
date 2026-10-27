import assert from "node:assert/strict";
import test from "node:test";
import { fixtureEvents } from "./fixtures.ts";
import { benchmarkParsers, runParser } from "./parser-benchmark.ts";

for (const scenario of ["weather", "parallel", "trip"] as const) {
  test(`benchmark runners agree on complete ${scenario} arguments`, () => {
    const events = fixtureEvents(scenario);
    assert.deepEqual(
      JSON.parse(JSON.stringify(runParser("without", events))),
      JSON.parse(JSON.stringify(runParser("with", events))),
    );
  });
}

test("batch averages divide elapsed time by replay count on both sides", () => {
  let time = 0;
  const progress: number[] = [];
  const result = benchmarkParsers(fixtureEvents("weather"), {
    samples: 3,
    warmups: 1,
    maxBatch: 4,
    targetBatchMs: 8,
    now: () => time++,
    onProgress: (sample) => progress.push(sample),
  });
  assert.equal(result.batch, 4);
  assert.equal(result.sourceBytes, 95);
  assert.equal(result.deltaEvents, 19);
  assert.deepEqual(progress, [1, 2, 3]);
  for (const side of ["without", "with"] as const) {
    assert.equal(result[side].firstRunMs, 1);
    assert.equal(result[side].medianMs, 0.25);
    assert.equal(result[side].p95Ms, 0.25);
  }
});

test("benchmarks reject incomplete or malformed streams instead of timing missing output", () => {
  assert.throws(
    () => runParser("with", fixtureEvents("weather").slice(0, -1)),
    /complete/,
  );
  assert.throws(
    () => runParser("without", fixtureEvents("weather").slice(0, -1)),
    /complete/,
  );
  assert.throws(() => benchmarkParsers(fixtureEvents("malformed")));
});
