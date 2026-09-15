import assert from "node:assert/strict";
import test from "node:test";
import { comparisonMessages, createComparison } from "./comparison.ts";
import { fixtureEvents } from "./fixtures.ts";

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
