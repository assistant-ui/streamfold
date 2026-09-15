import { useEffect, useSyncExternalStore } from "react";
import { Check, Timer } from "lucide-react";
import { engineWarmup } from "./engine-warmup.ts";

export function EngineWarmupStatus() {
  const snapshot = useSyncExternalStore(
    engineWarmup.subscribe,
    engineWarmup.getSnapshot,
  );
  useEffect(
    () =>
      engineWarmup.schedule((run) => {
        if (typeof window.requestIdleCallback === "function") {
          const id = window.requestIdleCallback(run, { timeout: 1_000 });
          return () => window.cancelIdleCallback(id);
        }
        // Give the initial UI a chance to paint in browsers without idle callbacks.
        const id = window.setTimeout(run, 100);
        return () => window.clearTimeout(id);
      }),
    [],
  );
  const ready = snapshot.state === "ready";
  return (
    <div
      className="engine-warmup-status"
      role="status"
      aria-label="Streamfold engine status"
      data-testid="engine-warmup"
      data-state={snapshot.state}
      data-source={snapshot.source}
      data-ms={snapshot.durationMs}
      data-attempts={snapshot.attempts}
    >
      {ready ? <Check size={13} /> : <Timer size={13} />}
      {ready ? (
        <>
          <strong>
            {snapshot.source === "background"
              ? "Streamfold preloaded"
              : "Streamfold ready"}
          </strong>
          <span>
            {snapshot.durationMs!.toFixed(1)} ms setup{" "}
            {snapshot.source === "background"
              ? "during idle time"
              : "on first use"}{" "}
            · cached for this page
          </span>
        </>
      ) : snapshot.state === "failed" ? (
        <span>
          Background warm-up unavailable · playback can retry initialization
        </span>
      ) : (
        <span>Preparing Streamfold during idle time…</span>
      )}
    </div>
  );
}
