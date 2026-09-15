import type { AssistantStreamChunk } from "assistant-stream";
import { createParserRunner, type ParserSide } from "./parser-runner.ts";

export type ParserMeasurement = {
  firstRunMs: number;
  medianMs: number;
  p95Ms: number;
};
export type ParserBenchmarkResult = {
  without: ParserMeasurement;
  with: ParserMeasurement;
  samples: number;
  batch: number;
  sourceBytes: number;
  deltaEvents: number;
};

export function runParser(
  side: ParserSide,
  events: readonly AssistantStreamChunk[],
) {
  const runner = createParserRunner(side);
  try {
    for (const event of events) runner.push(event);
    const calls = [...runner.calls.values()];
    if (
      !calls.length ||
      calls.some((call) => !call.complete) ||
      runner.activeStreams
    )
      throw new Error("Benchmark requires complete, valid tool arguments.");
    return calls.map((call) => call.args);
  } finally {
    runner.dispose();
  }
}

export function benchmarkParsers(
  events: readonly AssistantStreamChunk[],
  {
    samples = 15,
    warmups = 8,
    targetBatchMs = 8,
    maxBatch = 256,
    now = () => performance.now(),
    onProgress = (_sample: number) => {},
  } = {},
): ParserBenchmarkResult {
  const textByPath = new Map<string, string>();
  for (const event of events) {
    if (event.type === "part-start" && event.part.type === "tool-call")
      textByPath.set(event.path.join("/"), "");
    if (event.type === "text-delta") {
      const path = event.path.join("/");
      textByPath.set(path, (textByPath.get(path) ?? "") + event.textDelta);
    }
  }
  const expected = JSON.stringify(
    [...textByPath.values()].map((text) => JSON.parse(text)),
  );
  const firstRun = { without: 0, with: 0 };
  let consumed = 0;
  const batchTime = (side: ParserSide, batch: number) => {
    const started = now();
    for (let i = 0; i < batch; i++) consumed += runParser(side, events).length;
    return now() - started;
  };
  for (const side of ["without", "with"] as const) {
    const started = now();
    const result = runParser(side, events);
    firstRun[side] = now() - started;
    // Correctness is checked outside timing, including all final JSON values.
    if (JSON.stringify(result) !== expected)
      throw new Error(`${side} parser produced different final arguments.`);
  }
  for (let i = 0; i < warmups; i++) {
    runParser("without", events);
    runParser("with", events);
  }
  // Use the same batch size on both sides. Whole batches avoid adding hundreds
  // of quantized sub-millisecond clock readings together as playback does.
  let batch = 1;
  while (true) {
    const without = batchTime("without", batch);
    const withTime = batchTime("with", batch);
    if (Math.min(without, withTime) >= targetBatchMs || batch >= maxBatch)
      break;
    batch = Math.min(batch * 2, maxBatch);
  }
  const times = { without: [] as number[], with: [] as number[] };
  for (let sample = 0; sample < samples; sample++) {
    const order: ParserSide[] =
      sample % 2 ? ["with", "without"] : ["without", "with"];
    for (const side of order) times[side].push(batchTime(side, batch) / batch);
    onProgress(sample + 1);
  }
  if (!consumed) throw new Error("No benchmark results were consumed.");
  const summarize = (side: ParserSide): ParserMeasurement => {
    const sorted = times[side].toSorted((a, b) => a - b);
    return {
      firstRunMs: firstRun[side],
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
  };
  return {
    without: summarize("without"),
    with: summarize("with"),
    samples,
    batch,
    sourceBytes: [...textByPath.values()].reduce(
      (sum, text) => sum + new TextEncoder().encode(text).length,
      0,
    ),
    deltaEvents: events.filter((event) => event.type === "text-delta").length,
  };
}
