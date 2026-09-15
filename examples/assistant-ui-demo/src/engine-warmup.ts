import { createStructuredStream } from "streamfold";

export type EngineWarmupSnapshot = {
  state: "idle" | "scheduled" | "ready" | "failed";
  source?: "background" | "first-use";
  durationMs?: number;
  attempts: number;
};
type IdleScheduler = (run: () => void) => () => void;

function initializeEngine() {
  // The published API lazily initializes and caches the page's WASM instance.
  // Dispose the temporary parser, retaining only that shared engine. No fixture
  // is parsed and no tool call or result is created by warm-up.
  const scanner = createStructuredStream({ snapshots: "immutable" });
  scanner.dispose();
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
      initialize();
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
