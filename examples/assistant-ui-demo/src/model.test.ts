import assert from "node:assert/strict";
import test from "node:test";
import { runFixture, type Trace } from "./model.ts";

test("published Streamfold values become assistant-ui tool parts with immutable history", async () => {
  const frames = [];
  const traces: Trace[] = [];
  for await (const frame of runFixture({
    scenario: "weather",
    signal: new AbortController().signal,
    interval: 0,
    onTrace: (trace) => traces.push(trace),
  }))
    frames.push(frame);
  const firstPartial = frames
    .flatMap((frame) => frame.content ?? [])
    .find((part) => part.type === "tool-call" && part.args.city === "S");
  assert.ok(firstPartial?.type === "tool-call");
  assert.ok(Object.isFrozen(firstPartial.args));
  assert.equal(firstPartial.args.city, "S");
  const final = frames
    .at(-1)
    ?.content?.find((part) => part.type === "tool-call");
  assert.ok(final?.type === "tool-call");
  assert.equal(final.args.city, "San Francisco");
  assert.ok(final.result);
  assert.equal(traces.at(-1)?.state, "complete");
  assert.equal(traces.at(-1)?.sourceClosed, true);
});

test("interleaved calls retain separate arguments and complete once", async () => {
  let last: Trace | undefined;
  for await (const _ of runFixture({
    scenario: "parallel",
    signal: new AbortController().signal,
    interval: 0,
    onTrace: (trace) => {
      last = trace;
    },
  })) {
    /* drain */
  }
  assert.equal(last?.calls.length, 2);
  assert.equal(
    last?.entries.filter(
      (entry) => entry.direction === "out" && entry.type === "complete",
    ).length,
    2,
  );
  assert.deepEqual(
    last?.calls.map((call) => call.args),
    [
      {
        city: "San Francisco",
        units: "celsius",
        days: 3,
        notes: "A light layer for the waterfront.",
      },
      {
        city: "Oakland",
        units: "celsius",
        days: 3,
        notes: "A light layer for the waterfront.",
      },
    ],
  );
});

test("stop closes the source and never fabricates a result", async () => {
  const controller = new AbortController();
  const frames = [];
  let last: Trace | undefined;
  for await (const frame of runFixture({
    scenario: "weather",
    signal: controller.signal,
    interval: 0,
    onTrace: (trace) => {
      last = trace;
    },
  })) {
    frames.push(frame);
    if ((last?.inputCount ?? 0) >= 4) controller.abort();
  }
  assert.equal(last?.state, "cancelled");
  assert.equal(last?.sourceClosed, true);
  assert.ok(
    frames
      .flatMap((frame) => frame.content ?? [])
      .every((part) => part.type !== "tool-call" || !part.result),
  );
});

test("malformed arguments expose an error without completing the tool", async () => {
  const frames = [];
  let last: Trace | undefined;
  for await (const frame of runFixture({
    scenario: "malformed",
    signal: new AbortController().signal,
    interval: 0,
    onTrace: (trace) => {
      last = trace;
    },
  }))
    frames.push(frame);
  assert.equal(last?.state, "error");
  assert.ok(last?.error);
  assert.equal(last?.sourceClosed, true);
  assert.equal(frames.at(-1)?.status?.type, "incomplete");
  assert.ok(last?.calls.every((call) => !call.complete));
});

test("the complex fixture yields three validated tools and closes its source", async () => {
  let trace: Trace | undefined;
  let final;
  for await (const frame of runFixture({
    scenario: "trip",
    signal: new AbortController().signal,
    interval: 0,
    onTrace: (value) => {
      trace = value;
    },
  }))
    final = frame;
  const tools =
    final?.content?.filter((part) => part.type === "tool-call") ?? [];
  assert.deepEqual(
    tools.map((tool) => tool.toolName),
    ["get_weather", "show_forecast", "plan_trip"],
  );
  assert.ok(tools.every((tool) => tool.result));
  assert.equal(trace?.state, "complete");
  assert.equal(trace?.sourceClosed, true);
});
