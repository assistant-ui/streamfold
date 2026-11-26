"use client";

import { useEffect, useRef, useState } from "react";
import { createStructuredStream, type IncrementalJsonScanner } from "streamfold";

import { ControlIcon } from "./control-icon";

const commands = {
  npm: ["npm", "install", "streamfold"],
  pnpm: ["pnpm", "add", "streamfold"],
} as const;
const chunks = ['{"city":"', "San Fran", 'cisco",', '"units":"', 'metric"}'];

const intervalMs = 800;

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function hasCity(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "city" in value &&
    typeof value.city === "string" &&
    value.city.length > 0
  );
}

function OutputPane({
  label,
  name,
  output,
  firstCityMs,
  waiting,
}: {
  label: string;
  name: string;
  output: string;
  firstCityMs: number | null;
  waiting: string;
}) {
  return (
    <section className="pane" aria-label={name}>
      <small>{label}</small>
      <h3>{name}</h3>
      <div className="milestone">
        <span>First nonempty city</span>
        <strong>{firstCityMs === null ? "Pending" : seconds(firstCityMs)}</strong>
      </div>
      <pre data-empty={!output}>
        {output
          ? output.split("\n").map((line, index) => (
              <span key={line}>
                {index > 0 && "\n"}
                {line}
              </span>
            ))
          : waiting}
      </pre>
    </section>
  );
}

function CommandLine({ command }: { command: readonly string[] }) {
  const [result, setResult] = useState<"idle" | "copied" | "denied">("idle");
  const feedback = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(feedback.current), []);
  const code = useRef<HTMLElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command.join(" "));
      window.clearTimeout(feedback.current);
      setResult("copied");
      feedback.current = window.setTimeout(() => setResult("idle"), 1600);
    } catch {
      window.clearTimeout(feedback.current);
      setResult("denied");
      if (code.current) {
        const range = document.createRange();
        range.selectNodeContents(code.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }
  return (
    <>
      <div className="install">
        <span className="prompt" aria-hidden="true">
          $
        </span>
        <code ref={code}>
          <b>{command[0]}</b> {command[1]} <strong>{command[2]}</strong>
        </code>
        <button data-copied={result === "copied"} onClick={copy} aria-label="Copy install command">
          <ControlIcon name={result === "copied" ? "check" : "copy"} />
          <span aria-hidden="true">{result === "copied" ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <small role="status">
        {result === "denied" ? (
          "Copy blocked. Use Copy on the selected command."
        ) : result === "copied" ? (
          <span className="sr-only">Copied to clipboard.</span>
        ) : (
          ""
        )}
      </small>
    </>
  );
}

function Install() {
  const [manager, setManager] = useState<keyof typeof commands>("npm");
  return (
    <div className="install-wrap">
      <div className="install-options" role="group" aria-label="Package manager">
        {(["npm", "pnpm"] as const).map((name) => (
          <button key={name} aria-pressed={manager === name} onClick={() => setManager(name)}>
            {name}
          </button>
        ))}
      </div>
      <CommandLine key={manager} command={commands[manager]} />
    </div>
  );
}

export function Replay() {
  const scanner = useRef<IncrementalJsonScanner | null>(null);
  const [count, setCount] = useState(0);
  const [output, setOutput] = useState("");
  const buffer = useRef("");
  const [bufferedOutput, setBufferedOutput] = useState("");
  const [bufferedCityMs, setBufferedCityMs] = useState<number | null>(null);
  const [streamCityMs, setStreamCityMs] = useState<number | null>(null);
  const arrivalMs = Math.max(count - 1, 0) * intervalMs;
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const complete = count === chunks.length;
  const status = error
    ? "Error"
    : complete
      ? "Complete"
      : playing
        ? "Playing"
        : count
          ? "Paused"
          : "Ready";

  useEffect(() => () => scanner.current?.dispose(), []);
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) setPlaying(false);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  function reset() {
    scanner.current?.dispose();
    scanner.current = null;
    setPlaying(false);
    setCount(0);
    setOutput("");
    buffer.current = "";
    setBufferedOutput("");
    setBufferedCityMs(null);
    setStreamCityMs(null);
    setError("");
  }
  function advance(index: number) {
    try {
      const parser = (scanner.current ??= createStructuredStream());
      const fragment = chunks[index]!;
      const timeMs = index * intervalMs;
      buffer.current += fragment;
      const update = parser.push(fragment);
      const last = index + 1 === chunks.length;
      const state = last ? parser.finish() : update;
      if (hasCity(state.partialValue)) setStreamCityMs((first) => first ?? timeMs);
      setOutput(JSON.stringify(state.partialValue, null, 2));
      setCount(index + 1);
      if (last) {
        const parsed: unknown = JSON.parse(buffer.current);
        setBufferedOutput(JSON.stringify(parsed, null, 2));
        if (hasCity(parsed)) setBufferedCityMs(timeMs);
        parser.dispose();
        scanner.current = null;
        setPlaying(false);
      }
    } catch (cause) {
      scanner.current?.dispose();
      scanner.current = null;
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => advance(count), intervalMs);
    return () => window.clearTimeout(timer);
  }, [count, playing]);
  function play() {
    if (playing) return setPlaying(false);
    if (complete) reset();
    setPlaying(true);
    if (!count || complete) advance(0);
  }

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="eyebrow">Streamfold / Rust + Wasm</span>
          <h1 id="hero-title">
            JSON, <em>as it arrives.</em>
          </h1>
          <p>Turn fragmented tool-call arguments into live JSON values, one chunk at a time.</p>
        </div>
        <Install />
      </section>
      <section className="replay" aria-labelledby="replay-title">
        <div className="section-head">
          <h2 id="replay-title">Fragment replay</h2>
          <span className="file">weather.json</span>
        </div>
        <p className="comparison-note" role="status">
          {error ||
            (bufferedCityMs !== null && streamCityMs !== null ? (
              <>
                Streamfold returned a nonempty city{" "}
                <strong>{seconds(bufferedCityMs - streamCityMs)} earlier</strong>. Both finished at{" "}
                {seconds(arrivalMs)}.
              </>
            ) : streamCityMs !== null ? (
              <>Streamfold has a city. JSON.parse waits for all five fragments.</>
            ) : (
              <>
                Five fragments, {seconds(intervalMs)} apart.{" "}
                {count
                  ? "The next fragment adds the first city characters."
                  : "Step twice to see the first nonempty city."}
              </>
            ))}
        </p>
        <div className="console">
          <div className="controls">
            <div>
              <button className="primary" onClick={play} disabled={!!error}>
                <ControlIcon name={playing ? "pause" : complete ? "replay" : "play"} />
                {playing ? "Pause" : complete ? "Replay" : count ? "Resume" : "Play"}
              </button>
              <button disabled={playing || complete || !!error} onClick={() => advance(count)}>
                <ControlIcon name="step" />
                Step
              </button>
              <button disabled={!count && !error} onClick={reset}>
                <ControlIcon name="reset" />
                Reset
              </button>
            </div>
            <small role="status">
              <i className={count || playing ? "lit" : ""} />
              {status} · {count}/{chunks.length}
            </small>
          </div>
          <div className="arrival">
            <span>
              Simulated arrival <b>{seconds(arrivalMs)}</b>
            </span>
            <code>{count ? chunks[count - 1] : "Waiting for the first fragment"}</code>
            <a href="https://github.com/assistant-ui/streamfold/blob/v0.1.20/benchmarks/SDK_ADAPTER_REPORT.md">
              Parser benchmarks ↗
            </a>
          </div>
          <div className="arrival-track" aria-hidden="true">
            <span
              data-advancing={count > 1}
              style={{ transform: `scaleX(${count / chunks.length})` }}
            />
          </div>
          <div className="panes">
            <OutputPane
              label="Before · buffered"
              name="JSON.parse"
              output={bufferedOutput}
              firstCityMs={bufferedCityMs}
              waiting="Waiting for the final fragment…"
            />
            <OutputPane
              label="After · incremental"
              name="Streamfold"
              output={output}
              firstCityMs={streamCityMs}
              waiting="Waiting for input…"
            />
          </div>
        </div>
      </section>
      <section className="mechanism" id="how-it-works" aria-labelledby="method-title">
        <div className="section-head">
          <h2 id="method-title">How it works</h2>
          <a href="https://github.com/assistant-ui/streamfold#quick-start">Quick start ↗</a>
        </div>
        <ol className="method-list">
          <li>
            <code>01</code>
            <div>
              <h3>Create a scanner</h3>
              <p>
                <code>createStructuredStream()</code> starts one JSON document.
              </p>
            </div>
          </li>
          <li>
            <code>02</code>
            <div>
              <h3>Read the partial value</h3>
              <p>
                Pass each fragment to <code>push()</code>. Its <code>partialValue</code> contains
                the fields parsed so far.
              </p>
            </div>
          </li>
          <li>
            <code>03</code>
            <div>
              <h3>Finish the document</h3>
              <p>
                <code>finish()</code> validates the complete value. Call <code>dispose()</code> to
                release the scanner.
              </p>
            </div>
          </li>
        </ol>
      </section>
    </>
  );
}
