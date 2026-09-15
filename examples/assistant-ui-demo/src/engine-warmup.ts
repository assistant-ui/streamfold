import { createStructuredStream } from "streamfold";
import { createParserRunner } from "./parser-runner.ts";

export type EngineWarmupSnapshot = {
  state: "idle" | "scheduled" | "ready" | "failed";
  source?: "background" | "first-use";
  durationMs?: number;
  attempts: number;
};
type IdleScheduler = (run: () => void) => () => void;

function initializeEngine(source: "background" | "first-use") {
  if (source === "first-use") {
    // An early click only initializes the engine. Do not delay playback with a
    // synthetic stream; the real event exercises the parser itself.
    const scanner = createStructuredStream({ snapshots: "immutable" });
    scanner.dispose();
    return;
  }
  // Creating an empty scanner does not exercise push(), patch decoding, or
  // immutable snapshots. Prepare those paths once, for BOTH parsers, with the
  // same small, unrelated JSON stream. No demo fixture, validation, or tool runs.
  // This reduces first-use work, but does not guarantee optimized JIT code or
  // change the published parser's per-event overhead.
  const text =
    '{"label":"Preparing parsers","count":2,"items":[{"ready":true},null,3.5],"nested":{"label":"ok"}}';
  for (const side of ["without", "with"] as const) {
    const runner = createParserRunner(side);
    try {
      runner.push({
        type: "part-start",
        path: [0],
        part: { type: "tool-call", toolCallId: "prepare", toolName: "prepare" },
      });
      for (let offset = 0; offset < text.length; offset += 6)
        runner.push({
          type: "text-delta",
          path: [0],
          textDelta: text.slice(offset, offset + 6),
        });
      runner.push({ type: "tool-call-args-text-finish", path: [0] });
    } finally {
      runner.dispose();
    }
  }
}

export function createEngineWarmup(
  initialize = initializeEngine,
  now = () => performance.now(),
) {
  let snapshot: EngineWarmupSnapshot = { state: "idle", attempts: 0 };
  let cancelPending: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: EngineWarmupSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const prepare = (source: "background" | "first-use") => {
    if (snapshot.state === "ready") return true;
    cancelPending?.();
    const started = now();
    const attempts = snapshot.attempts + 1;
    try {
      initialize(source);
      publish({
        state: "ready",
        source,
        durationMs: now() - started,
        attempts,
      });
      return true;
    } catch {
      // Background preparation is optional. The real parser path can retry and
      // report its normal error rather than making the whole demo fail to load.
      publish({
        state: "failed",
        source,
        durationMs: now() - started,
        attempts,
      });
      return false;
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prepare,
    schedule(scheduleIdle: IdleScheduler) {
      if (snapshot.state === "ready" || cancelPending) return () => {};
      publish({ ...snapshot, state: "scheduled" });
      let active = true;
      const cancel = scheduleIdle(() => {
        if (!active) return;
        active = false;
        cancelPending = undefined;
        prepare("background");
      });
      const cleanup = () => {
        if (!active) return;
        active = false;
        cancel();
        cancelPending = undefined;
        publish({ ...snapshot, state: "idle" });
      };
      if (active) cancelPending = cleanup;
      return cleanup;
    },
  };
}

// One controller and one library module instance for the page. Workers have
// their own module context; a benchmark worker intentionally starts cold.
export const engineWarmup = createEngineWarmup();
export const ensureStreamfoldReady = () => engineWarmup.prepare("first-use");
