import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  ArrowRight,
  CloudSun,
  Pause,
  Play,
  RotateCcw,
  Square,
  StepForward,
  Timer,
} from "lucide-react";
import { AssistantMessage, UserMessage } from "./SingleDemo.tsx";
import { scenarios, type Scenario } from "./fixtures.ts";
import { ParserBenchmark } from "./ParserBenchmark.tsx";
import {
  comparisonMessages,
  createComparison,
  type ComparisonSnapshot,
  type Side,
  type ParserView,
} from "./comparison.ts";
import comparisonSource from "./comparison.ts?raw";
import parserSource from "./parser-runner.ts?raw";

const convertMessage = (message: ThreadMessageLike) => message;
const noNewMessages = async () => {};
const bytes = (value: number) => `${value.toLocaleString("en-US")} B`;

function ParserTiming({
  parser,
  side,
  playing,
  elapsedMs,
}: {
  parser: ParserView;
  side: Side;
  playing: boolean;
  elapsedMs: (side: Side) => number;
}) {
  // Only this small counter rerenders between chunks, not the tool components.
  const [, tick] = useState(0);
  const finished = parser.finishedAtMs !== undefined;
  useEffect(() => {
    if (!playing || finished) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 50);
    return () => window.clearInterval(timer);
  }, [playing, finished]);
  const playbackMs = elapsedMs(side);
  const caption =
    parser.state === "complete"
      ? "Finished in"
      : parser.state === "error"
        ? "Failed after"
        : parser.state === "cancelled"
          ? "Stopped at"
          : playing
            ? "Counting"
            : parser.state === "idle"
              ? "Ready"
              : "Paused at";
  return (
    <div className="parser-timing" data-state={parser.state}>
      <div>
        <span className="timing-label">
          <Timer size={13} /> Playback time
        </span>
        <div
          className="timing-value"
          role="timer"
          aria-live="off"
          aria-label="Playback seconds"
        >
          <strong data-testid={`${side}-elapsed`} data-ms={playbackMs}>
            {(playbackMs / 1000).toFixed(2)}
          </strong>
          <span>s</span>
        </div>
        <small data-testid={`${side}-timing-status`}>
          {caption} · excludes pauses
        </small>
      </div>
      <div>
        <span className="timing-label">Live parser work</span>
        <div className="timing-value parser-time-value">
          <strong data-testid={`${side}-parser-time`} data-ms={parser.parserMs}>
            {parser.parserMs.toFixed(1)}
          </strong>
          <span>ms</span>
        </div>
        <small>Single run · includes startup</small>
        <small className="timing-breakdown">
          Deltas {parser.deltaMs.toFixed(1)} ms · start / finish{" "}
          {parser.lifecycleMs.toFixed(1)} ms
        </small>
      </div>
    </div>
  );
}

function ParserPane({
  frame,
  side,
  playing,
  elapsedMs,
}: {
  frame: ComparisonSnapshot;
  side: Side;
  playing: boolean;
  elapsedMs: (side: Side) => number;
}) {
  const parser = frame[side];
  const incremental = side === "with";
  const messages = useMemo(
    () => comparisonMessages(frame, side),
    [frame, side],
  );
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    onNew: noNewMessages,
    isRunning: playing && parser.state === "running",
  });
  const state =
    parser.state === "running"
      ? playing
        ? "Streaming"
        : "Paused"
      : parser.state;
  return (
    <section
      className={`comparison-pane ${side}`}
      aria-labelledby={`${side}-title`}
      data-testid={`${side}-pane`}
    >
      <header className="comparison-pane-heading">
        <div>
          <span className="eyebrow">
            {incremental ? "Incremental parser" : "Baseline parser"}
          </span>
          <h2 id={`${side}-title`}>
            {incremental ? "With Streamfold" : "Without Streamfold"}
          </h2>
        </div>
        <span
          className="comparison-state"
          data-state={parser.state}
          data-testid={`${side}-state`}
        >
          {state}
        </span>
      </header>
      <p className="parser-description">
        {incremental
          ? "Each new chunk continues the existing parser."
          : "Each update parses the accumulated argument text."}
      </p>
      <ParserTiming
        parser={parser}
        side={side}
        playing={playing}
        elapsedMs={elapsedMs}
      />
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="comparison-thread">
          <ThreadPrimitive.Viewport
            className="comparison-viewport"
            autoScroll={false}
            scrollToBottomOnInitialize={false}
            scrollToBottomOnRunStart={false}
            scrollToBottomOnThreadSwitch={false}
          >
            <ThreadPrimitive.Empty>
              <div className="comparison-empty">
                <CloudSun size={30} strokeWidth={1.3} />
                <strong>The same forecast, one chunk at a time.</strong>
                <p>Play both sides or step through a single event.</p>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
      <div className="parser-inspector">
        <div className="parser-totals">
          <div>
            <span>Total parser input</span>
            <strong data-testid={`${side}-bytes`}>
              {bytes(parser.parserBytes)}
            </strong>
          </div>
          <div>
            <span>Parsing calls</span>
            <strong>{parser.parserCalls}</strong>
          </div>
        </div>
        <div className="parser-input-heading">
          <h3>Last parser input</h3>
          <span>{incremental ? "New chunk" : "Full text so far"}</span>
        </div>
        <pre className="parser-input" data-testid={`${side}-input`}>
          {parser.lastInput || "Waiting for a text delta…"}
        </pre>
        <code className="parser-method">
          {incremental
            ? "scanner.push(newChunk)"
            : "parsePartialJsonObject(allText)"}
        </code>
        {parser.error && (
          <div className="error-banner" role="alert">
            <div>
              <strong>Stopped at event {parser.errorEvent}</strong>
              <p>{parser.error}</p>
            </div>
          </div>
        )}
        <details className="parsed-details">
          <summary>
            Parsed arguments
            {parser.calls.length > 1 ? ` · ${parser.calls.length} calls` : ""}
          </summary>
          <pre data-testid={`${side}-args`}>
            {JSON.stringify(
              parser.calls.map((call) => ({
                id: call.toolCallId,
                args: call.args,
              })),
              null,
              2,
            )}
          </pre>
        </details>
      </div>
    </section>
  );
}

function ComparisonSession({
  scenario,
  onScenario,
  onReset,
}: {
  scenario: Scenario;
  onScenario: (scenario: Scenario) => void;
  onReset: () => void;
}) {
  const [comparison] = useState(() => createComparison(scenario));
  const [frame, setFrame] = useState(comparison.snapshot);
  const [playing, setPlaying] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [interval, setIntervalMs] = useState(180);
  useEffect(() => () => comparison.dispose(), [comparison]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = comparison.next();
      setFrame(next);
      if (!next.canStep) setPlaying(false);
    }, interval);
    return () => window.clearInterval(timer);
  }, [comparison, playing, interval]);
  const step = () => setFrame(comparison.next());
  const togglePlayback = () => {
    if (playing) comparison.pause();
    else comparison.play();
    setPlaying(!playing);
  };
  const stop = () => {
    setPlaying(false);
    setFrame(comparison.cancel());
  };
  const ratio = frame.with.parserBytes
    ? frame.without.parserBytes / frame.with.parserBytes
    : 1;
  return (
    <main className="comparison-workspace">
      <div className="comparison-intro">
        <div>
          <span className="eyebrow">
            Same events. Same assistant-ui components.
          </span>
          <h1>Watch what changes inside the parser.</h1>
          <p>
            Both already stream partial arguments. Follow the same fixture
            through two real parsers. Watch playback seconds and measured parser
            milliseconds on each side.
          </p>
        </div>
        <span className="fixture-badge">
          <span className="source-dot" />
          Local fixture · No API key
        </span>
      </div>
      <div className="toolbar comparison-toolbar">
        <div className="scenario-control">
          <label htmlFor="compare-scenario">Scenario</label>
          <select
            id="compare-scenario"
            value={scenario}
            onChange={(event) => onScenario(event.target.value as Scenario)}
          >
            {Object.entries(scenarios).map(([id, item]) => (
              <option key={id} value={id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="speed-control">
          <label htmlFor="compare-delay">Event delay</label>
          <input
            id="compare-delay"
            type="range"
            min="40"
            max="600"
            step="20"
            value={interval}
            onChange={(event) => setIntervalMs(Number(event.target.value))}
          />
          <output htmlFor="compare-delay">{interval} ms</output>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            onClick={onReset}
            title="Reset comparison"
            aria-label="Reset comparison"
          >
            <RotateCcw size={16} />
          </button>
          <button
            className="secondary"
            onClick={stop}
            disabled={!frame.canStep || (!playing && frame.index === 0)}
          >
            <Square size={13} />
            Stop
          </button>
          <button
            className="secondary"
            onClick={step}
            disabled={playing || benchmarking || !frame.canStep}
          >
            <StepForward size={15} />
            Step
          </button>
          <button
            className="primary"
            disabled={benchmarking || !frame.canStep}
            onClick={togglePlayback}
          >
            {playing ? (
              <Pause size={14} />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
            {playing ? "Pause" : frame.index ? "Resume" : "Play both"}
          </button>
        </div>
      </div>
      <ParserBenchmark
        scenario={scenario}
        playing={playing}
        onBusy={setBenchmarking}
      />
      <div className="shared-event">
        <span className="event-progress" data-testid="event-progress">
          Event {frame.index} / {frame.total}
        </span>
        <progress
          value={frame.index}
          max={frame.total}
          aria-label="Fixture playback"
        />
        <span className="event-type">
          {frame.lastEvent?.type ?? "Ready to play"}
        </span>
        <code>
          {frame.lastEvent?.text
            ? JSON.stringify(frame.lastEvent.text)
            : (frame.lastEvent?.id ?? "One source → two parsers")}
        </code>
        <span className="source-bytes">
          {bytes(frame.sourceBytes)} received
        </span>
      </div>
      <div className="comparison-grid">
        <ParserPane
          frame={frame}
          side="without"
          playing={playing}
          elapsedMs={comparison.elapsedMs}
        />
        <ParserPane
          frame={frame}
          side="with"
          playing={playing}
          elapsedMs={comparison.elapsedMs}
        />
      </div>
      <div className="comparison-takeaway">
        <ArrowRight size={18} />
        <p>
          {frame.with.error || frame.without.error ? (
            <strong>
              Each parser stops independently when it detects an error. Their
              input totals can cover different events.{" "}
            </strong>
          ) : frame.with.parserBytes > 0 ? (
            <>
              <strong>
                {ratio.toFixed(1)}× as many input bytes passed to the baseline
                parser.
              </strong>{" "}
            </>
          ) : (
            <strong>Play or step to compare the parser inputs. </strong>
          )}
          Playback clocks include the shared event delay, so both sides normally
          finish together. Live parser work measures event processing on both
          sides, including startup and partial snapshots, excluding rendering
          and tool execution. Tiny live readings are noisy and can favor either
          side. Use the repeated benchmark above to compare warmed processing.
        </p>
      </div>
      <footer className="comparison-footer">
        <p>
          The baseline uses assistant-stream’s published parser. Streamfold uses
          its published assistant-ui event adapter. Both render through
          assistant-ui’s external-store runtime. This demo does not replace
          assistant-ui’s internal parser.
        </p>
        <details>
          <summary>View the comparison source</summary>
          <pre>{comparisonSource}</pre>
        </details>
        <details>
          <summary>View the shared parser implementation</summary>
          <pre>{parserSource}</pre>
        </details>
      </footer>
    </main>
  );
}

export function Comparison() {
  const [scenario, setScenario] = useState<Scenario>("weather");
  const [replay, setReplay] = useState(0);
  return (
    <ComparisonSession
      key={`${scenario}-${replay}`}
      scenario={scenario}
      onScenario={setScenario}
      onReset={() => setReplay((value) => value + 1)}
    />
  );
}
