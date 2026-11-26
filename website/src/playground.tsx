"use client";

import { useEffect, useRef, useState } from "react";
import { createStructuredStream, type IncrementalJsonScanner } from "streamfold";

import { ControlIcon } from "./control-icon";

import { Adapters } from "./adapters";
import { Fold } from "./fold";

const commands = {
  npm: ["npm", "install", "streamfold"],
  pnpm: ["pnpm", "add", "streamfold"],
} as const;
const chunks = ['{"city":"', "San Fran", 'cisco",', '"units":"', 'metric"}'];

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
    <>
      <section className="hero ruled">
        <div className="hero-copy">
          <a className="release" href="https://www.npmjs.com/package/streamfold/v/0.1.20">
            <code>v0.1.20</code> Playground release <span aria-hidden="true">→</span>
          </a>
          <h1>
            JSON, as it arrives.
            <br />
            <em>Render each partial value.</em>
          </h1>
          <p>
            Turn fragmented tool-call arguments into live JSON values, one chunk at a time.
            Streamfold keeps its place between chunks, so you can render an object before it closes.
          </p>
          <div className="hero-actions">
            <a
              className="primary-link"
              href="https://github.com/assistant-ui/streamfold#quick-start"
            >
              Get started <span aria-hidden="true">→</span>
            </a>
            <a href="#how-it-works">How it works</a>
          </div>
          <Install />
        </div>
        <section className="console" aria-labelledby="replay-title">
          <div className="window-head">
            <h2 id="replay-title">Fragment replay</h2>
            <span>weather.json</span>
          </div>
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
                    <small>{i < count ? "received" : "queued"}</small>
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
        </section>
      </section>
      <Adapters />
      <section className="mechanism ruled" id="how-it-works" aria-labelledby="fold-heading">
        <div className="eyebrow">
          01 <span>How it works</span>
        </div>
        <h2 id="fold-heading">From fragment to value.</h2>
        <p>
          Follow the same weather call through five pushes. Each fragment adds one facet to the
          fold.
        </p>
        <div className="scene-layout">
          <Fold
            count={count}
            chunks={chunks}
            output={output}
            playing={playing}
            disabled={!!error}
            onPlay={play}
            onStep={() => advance(count)}
          />

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
        </div>
      </section>
    </>
  );
}
