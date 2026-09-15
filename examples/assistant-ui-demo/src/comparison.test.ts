import assert from "node:assert/strict";
import test from "node:test";
import { comparisonMessages, createComparison } from "./comparison.ts";
import { fixtureEvents } from "./fixtures.ts";

test("playback clocks exclude pauses and freeze at completion", () => {
  let time = 1_000;
  const comparison = createComparison("weather", { now: () => time });
  assert.equal(comparison.elapsedMs("with"), 0);
  time += 5_000;
  assert.equal(comparison.elapsedMs("with"), 0);
  comparison.play();
  time += 500;
  assert.equal(comparison.elapsedMs("with"), 500);
  comparison.next();
  comparison.pause();
  time += 10_000;
  comparison.next(); // A manual step must not include time spent paused.
  for (const side of ["without", "with"] as const) {
    assert.equal(comparison.elapsedMs(side), 500);
    assert.equal(comparison.snapshot()[side].parserMs, 0);
  }
  comparison.play();
  time += 250;
  while (comparison.snapshot().canStep) comparison.next();
  time += 5_000;
  for (const side of ["without", "with"] as const) {
    assert.equal(comparison.elapsedMs(side), 750);
    assert.equal(comparison.snapshot()[side].finishedAtMs, 750);
  }
  comparison.play();
  time += 5_000;
  assert.equal(comparison.elapsedMs("with"), 750);
  comparison.dispose();
});

test("stop before the first event freezes both clocks without creating calls", () => {
  let time = 0;
  const comparison = createComparison("weather", { now: () => time });
  comparison.play();
  time = 80;
  const stopped = comparison.cancel();
  time = 10_000;
  for (const side of ["without", "with"] as const) {
    assert.equal(stopped[side].state, "cancelled");
    assert.equal(comparison.elapsedMs(side), 80);
    assert.equal(stopped[side].parserMs, 0);
    assert.equal(stopped[side].calls.length, 0);
  }
  assert.equal(comparison.next(), stopped);
  comparison.dispose();
});

test("parser timing counts measured calls, excludes idle gaps, and retains history", () => {
  let time = 0;
  const comparison = createComparison("weather", { now: () => time++ });
  const start = comparison.next();
  assert.equal(start.without.parserMs, 1);
  assert.equal(start.with.parserMs, 1);
  assert.equal(start.without.lifecycleMs, 1);
  assert.equal(start.with.lifecycleMs, 1);
  assert.equal(start.without.deltaMs, 0);
  assert.equal(start.with.deltaMs, 0);
  time += 10_000;
  const partial = comparison.next();
  assert.equal(partial.without.parserMs, 2);
  assert.equal(partial.with.parserMs, 2);
  while (comparison.snapshot().canStep) comparison.next();
  const complete = comparison.snapshot();
  assert.equal(complete.without.parserMs, 21);
  assert.equal(complete.with.parserMs, 21);
  for (const side of ["without", "with"] as const) {
    assert.equal(complete[side].deltaMs, 19);
    assert.equal(complete[side].lifecycleMs, 2);
    assert.equal(
      complete[side].parserMs,
      complete[side].deltaMs + complete[side].lifecycleMs,
    );
  }
  assert.equal(partial.with.parserMs, 2);
  assert.equal(start.with.parserMs, 1);
  time += 10_000;
  assert.equal(comparison.next(), complete);
  comparison.dispose();
});

test("a parser error freezes its clock while the other side continues", () => {
  let time = 0;
  const comparison = createComparison("malformed", { now: () => time });
  comparison.play();
  while (comparison.snapshot().with.state !== "error") {
    time += 180;
    comparison.next();
  }
  const failed = comparison.snapshot().with;
  const failedAt = comparison.elapsedMs("with");
  assert.ok(comparison.snapshot().without.state !== "error");
  time += 500;
  assert.equal(comparison.elapsedMs("with"), failedAt);
  assert.ok(comparison.elapsedMs("without") > failedAt);
  while (comparison.snapshot().canStep) {
    time += 180;
    comparison.next();
  }
  assert.equal(comparison.snapshot().with, failed);
  assert.equal(comparison.elapsedMs("with"), failedAt);
  comparison.dispose();
});

for (const scenario of ["weather", "parallel"] as const) {
  test(`${scenario}: both real parsers complete the same calls, with measured input bytes`, () => {
    const comparison = createComparison(scenario);
    const snapshots = [comparison.snapshot()];
    const encoder = new TextEncoder();
    const accumulated = new Map<string, string>();
    let baselineBytes = 0;
    let deltaBytes = 0;
    let parseCalls = 0;
    try {
      for (const event of fixtureEvents(scenario)) {
        const frame = comparison.next();
        snapshots.push(frame);
        if (event.type === "text-delta") {
          const id = event.path.join("/");
          const text = (accumulated.get(id) ?? "") + event.textDelta;
          accumulated.set(id, text);
          baselineBytes += encoder.encode(text).length;
          deltaBytes += encoder.encode(event.textDelta).length;
          parseCalls++;
          assert.equal(frame.with.lastInput, event.textDelta);
          assert.equal(frame.without.lastInput, text);
        }
        assert.equal(frame.with.parserBytes, deltaBytes);
        assert.equal(frame.without.parserBytes, baselineBytes);
        assert.equal(frame.sourceBytes, deltaBytes);
        assert.equal(frame.with.parserCalls, parseCalls);
        assert.equal(frame.without.parserCalls, parseCalls);
      }
      const final = comparison.snapshot();
      assert.equal(final.with.state, "complete");
      assert.equal(final.without.state, "complete");
      assert.equal(final.with.calls.length, scenario === "parallel" ? 2 : 1);
      assert.deepEqual(
        JSON.parse(JSON.stringify(final.with.calls)),
        JSON.parse(JSON.stringify(final.without.calls)),
      );
      assert.ok(final.with.calls.every((call) => call.result));
      assert.ok(baselineBytes > deltaBytes);
      assert.equal(comparison.activeStreams, 0);
      assert.equal(comparison.next(), final);
      const partial = snapshots.find(
        (frame) => frame.with.calls[0]?.args.city === "S",
      );
      assert.ok(partial);
      assert.equal(partial.with.calls[0].result, undefined);
      assert.equal(partial.with.calls[0].args.city, "S");
      assert.equal(snapshots[0].index, 0);
      assert.equal(snapshots[0].with.calls.length, 0);
    } finally {
      comparison.dispose();
    }
  });
}

test("stopping keeps partial arguments and releases streams without producing a result", () => {
  const comparison = createComparison("weather");
  for (let i = 0; i < 5; i++) comparison.next();
  const partial = comparison.snapshot();
  const stopped = comparison.cancel();
  assert.equal(comparison.activeStreams, 0);
  assert.equal(stopped.canStep, false);
  for (const side of ["without", "with"] as const) {
    assert.equal(stopped[side].state, "cancelled");
    assert.deepEqual(stopped[side].calls, partial[side].calls);
    assert.ok(stopped[side].calls.every((call) => !call.result));
    assert.deepEqual(comparisonMessages(stopped, side)[1].status, {
      type: "incomplete",
      reason: "cancelled",
    });
  }
  assert.equal(comparison.next(), stopped);
  comparison.dispose();
});

test("malformed input fails each parser independently and never executes a tool", () => {
  const comparison = createComparison("malformed");
  try {
    while (comparison.snapshot().canStep) comparison.next();
    const frame = comparison.snapshot();
    for (const side of ["without", "with"] as const) {
      assert.equal(frame[side].state, "error");
      assert.ok(frame[side].error);
      assert.ok(frame[side].calls.every((call) => !call.result));
    }
    assert.ok(frame.with.errorEvent! < frame.without.errorEvent!);
    assert.equal(comparison.activeStreams, 0);
  } finally {
    comparison.dispose();
  }
});

test("disposing a paused comparison prevents further input", () => {
  const comparison = createComparison("parallel");
  comparison.next();
  comparison.next();
  assert.equal(comparison.activeStreams, 2);
  comparison.dispose();
  assert.equal(comparison.activeStreams, 0);
  const frame = comparison.snapshot();
  assert.equal(frame.canStep, false);
  assert.equal(comparison.next(), frame);
});

test("complex tools keep distinct schemas and publish immutable nested arrays", () => {
  const comparison = createComparison("trip");
  let retained: unknown;
  let retainedJson: string | undefined;
  try {
    while (comparison.snapshot().canStep) {
      const frame = comparison.next();
      const trip = frame.with.calls.find(
        (call) => call.toolName === "plan_trip",
      );
      if (!retained && trip?.args.days) {
        retained = trip.args;
        retainedJson = JSON.stringify(retained);
      }
    }
    const frame = comparison.snapshot();
    assert.equal(frame.with.state, "complete");
    assert.equal(frame.without.state, "complete");
    assert.deepEqual(
      frame.with.calls.map((call) => call.toolName),
      ["get_weather", "show_forecast", "plan_trip"],
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(frame.with.calls)),
      JSON.parse(JSON.stringify(frame.without.calls)),
    );
    assert.ok(frame.with.calls.every((call) => call.result));
    const trip = frame.with.calls.find(
      (call) => call.toolName === "plan_trip",
    )!;
    assert.equal((trip.args.days as unknown[]).length, 3);
    assert.ok(retainedJson);
    assert.equal(JSON.stringify(retained), retainedJson);
    assert.equal(comparison.activeStreams, 0);
  } finally {
    comparison.dispose();
  }
});
