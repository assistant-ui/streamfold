"use client";

import { useEffect, useRef, useState } from "react";
import { createStructuredStream, type IncrementalJsonScanner } from "streamfold";

const install = "npm install streamfold";
const chunks = ['{"city":"', "San Fran", 'cisco",', '"units":"', 'metric"}'];

export function Install() {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(install);
      setMessage("Copied");
    } catch {
      setMessage("Select the command to copy it.");
    }
  }
  return (
    <div className="install-wrap">
      <div className="install">
        <span aria-hidden="true">$</span>
        <code>{install}</code>
        <button onClick={copy} aria-label="Copy install command">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="8" y="8" width="12" height="13" rx="2" />
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>
      <small role="status">{message}</small>
    </div>
  );
}

export function Replay() {
  const scanner = useRef<IncrementalJsonScanner | null>(null);
  const [count, setCount] = useState(0);
  const [output, setOutput] = useState("");
  const [bytes, setBytes] = useState(0);
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
  function reset() {
    scanner.current?.dispose();
    scanner.current = null;
    setPlaying(false);
    setCount(0);
    setOutput("");
    setBytes(0);
    setError("");
  }
  function advance(index: number) {
    try {
      const parser = (scanner.current ??= createStructuredStream());
      const update = parser.push(chunks[index]!);
      const last = index + 1 === chunks.length;
      const state = last ? parser.finish() : update;
      setBytes(state.bytesSeen);
      setOutput(JSON.stringify(state.partialValue, null, 2));
      setCount(index + 1);
      if (last) {
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
    const timer = window.setTimeout(() => advance(count), 800);
    return () => window.clearTimeout(timer);
  }, [count, playing]);
  function play() {
    if (playing) return setPlaying(false);
    if (complete) reset();
    setPlaying(true);
    advance(complete ? 0 : count);
  }

  return (
    <section className="replay" aria-labelledby="replay-title">
      <div className="section-head">
        <div>
          <span className="label">01 / Playground</span>
          <h2 id="replay-title">Fragment replay</h2>
        </div>
        <span className="file">weather.json</span>
      </div>
      <div className="console">
        <div className="panes">
          <div className="pane">
            <h3>Incoming fragments</h3>
            <ol>
              {chunks.map((chunk, i) => (
                <li
                  key={chunk}
                  className={i === count - 1 ? "current" : i < count ? "sent" : ""}
                  aria-current={i === count - 1 ? "step" : undefined}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <code>{chunk}</code>
                  {i === count - 1 && <b aria-label="Last received">←</b>}
                </li>
              ))}
            </ol>
          </div>
          <div className="pane result">
            <h3>
              Partial value <span>{bytes} B</span>
            </h3>
            <pre>{error || output || "// Waiting for the first fragment"}</pre>
          </div>
        </div>
        <div className="controls">
          <div>
            <button className="primary" onClick={play} disabled={!!error}>
              <span aria-hidden="true">{playing ? "Ⅱ" : "▸"}</span>
              {playing ? "Pause" : complete ? "Replay" : count ? "Resume" : "Play"}
            </button>
            <button disabled={playing || complete || !!error} onClick={() => advance(count)}>
              Step
            </button>
            <button disabled={!count && !error} onClick={reset}>
              Reset
            </button>
          </div>
          <small role="status">
            <i className={count || playing ? "lit" : ""} />
            {status} · {count}/{chunks.length}
          </small>
        </div>
      </div>
    </section>
  );
}
