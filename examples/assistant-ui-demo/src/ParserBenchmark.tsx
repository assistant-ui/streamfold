import { useEffect, useRef, useState } from "react";
import { Gauge, Square } from "lucide-react";
import { scenarios, type Scenario } from "./fixtures.ts";
import type { ParserBenchmarkResult } from "./parser-benchmark.ts";

export function ParserBenchmark({
  scenario,
  playing,
  onBusy,
}: {
  scenario: Scenario;
  playing: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const worker = useRef<Worker | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ParserBenchmarkResult>();
  const [error, setError] = useState<string>();
  useEffect(() => () => worker.current?.terminate(), []);
  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    onBusy(false);
  };
  const run = () => {
    setResult(undefined);
    setError(undefined);
    setProgress(0);
    setRunning(true);
    onBusy(true);
    try {
      const current = new Worker(
        new URL("./parser-benchmark.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = current;
      current.onmessage = (
        event: MessageEvent<
          | { type: "progress"; sample: number }
          | { type: "result"; result: ParserBenchmarkResult }
          | { type: "error"; message: string }
        >,
      ) => {
        if (worker.current !== current) return;
        if (event.data.type === "progress") setProgress(event.data.sample);
        else {
          if (event.data.type === "result") setResult(event.data.result);
          else setError(event.data.message);
          stop();
        }
      };
      current.onerror = () => {
        if (worker.current !== current) return;
        setError("The benchmark could not run. Try again.");
        stop();
      };
      current.postMessage({ scenario });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      stop();
    }
  };
  return (
    <section
      className="timing-benchmark"
      aria-label="Repeated parser benchmark"
    >
      <div className="benchmark-heading">
        <div>
          <h2>
            <Gauge size={15} /> Check parsing performance
          </h2>
          <p>
            Warm both parsers, repeat the same fixture, and compare median
            processing time.
          </p>
        </div>
        <button
          className="secondary"
          onClick={running ? stop : run}
          disabled={playing || scenario === "malformed"}
        >
          {running ? <Square size={13} /> : <Gauge size={15} />}
          {running ? "Cancel benchmark" : "Run repeated benchmark"}
        </button>
      </div>
      <p
        className="benchmark-status"
        role="status"
        aria-label="Benchmark status"
      >
        {running
          ? progress
            ? `Measuring batch ${progress} / 15…`
            : "Warming both parsers…"
          : playing
            ? "Available when playback is paused or finished."
            : scenario === "malformed"
              ? "Choose a valid fixture to benchmark matching completed results."
              : result
                ? `${scenarios[scenario].name} · ${result.sourceBytes.toLocaleString()} bytes · ${result.samples} batches of ${result.batch} replays per parser`
                : "Runs in a separate worker. Playback timers below remain individual live measurements."}
      </p>
      {result && (
        <div
          className="benchmark-results"
          data-testid="benchmark-results"
          role="region"
          aria-label="Benchmark timing results"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Parser</th>
                <th>First replay</th>
                <th>Warm median</th>
                <th>Warm p95</th>
              </tr>
            </thead>
            <tbody>
              {(["without", "with"] as const).map((side) => (
                <tr key={side}>
                  <th>
                    {side === "with" ? "With Streamfold" : "Without Streamfold"}
                  </th>
                  <td>{result[side].firstRunMs.toFixed(3)} ms</td>
                  <td data-testid={`${side}-benchmark-median`}>
                    {result[side].medianMs.toFixed(3)} ms
                  </td>
                  <td>{result[side].p95Ms.toFixed(3)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Time per full replay, including event handling, partial snapshots,
            and finalization. First replay includes startup in a fresh worker.
            Warm columns use batch averages and exclude initial engine startup.
            No playback delays, rendering, or tool execution; either parser can
            win.
          </p>
        </div>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
