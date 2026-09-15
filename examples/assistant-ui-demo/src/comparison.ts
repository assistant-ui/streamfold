import type {
  ThreadMessageLike,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import { fixtureEvents, scenarios, type Scenario } from "./fixtures.ts";
import { resultFor } from "./tool-data.ts";
import { createParserRunner } from "./parser-runner.ts";
import { ensureStreamfoldReady } from "./engine-warmup.ts";

export type Side = "without" | "with";
type SideState = "idle" | "running" | "complete" | "cancelled" | "error";
export type ParserView = {
  state: SideState;
  calls: readonly ToolCallMessagePart[];
  parserBytes: number;
  parserCalls: number;
  parserMs: number;
  deltaMs: number;
  lifecycleMs: number;
  finishedAtMs?: number;
  lastInput: string;
  error?: string;
  errorEvent?: number;
};
export type ComparisonSnapshot = {
  scenario: Scenario;
  index: number;
  total: number;
  sourceBytes: number;
  lastEvent?: { type: string; id: string; text: string };
  canStep: boolean;
  without: ParserView;
  with: ParserView;
};
const emptyParser = (): ParserView => ({
  state: "idle",
  calls: [],
  parserBytes: 0,
  parserCalls: 0,
  parserMs: 0,
  deltaMs: 0,
  lifecycleMs: 0,
  lastInput: "",
});

export function createComparison(
  scenario: Scenario,
  { now = () => performance.now() }: { now?: () => number } = {},
) {
  const events = fixtureEvents(scenario);
  const runners = {
    without: createParserRunner("without"),
    with: createParserRunner("with"),
  };
  const idsByPath = new Map<string, string>();
  const calls = {
    without: new Map<string, ToolCallMessagePart>(),
    with: new Map<string, ToolCallMessagePart>(),
  };
  const encoder = new TextEncoder();
  let frame: ComparisonSnapshot = {
    scenario,
    index: 0,
    total: events.length,
    sourceBytes: 0,
    canStep: true,
    without: emptyParser(),
    with: emptyParser(),
  };
  let playedMs = 0;
  let activeSince: number | undefined;
  const elapsed = () =>
    playedMs + (activeSince === undefined ? 0 : now() - activeSince);
  const pause = () => {
    playedMs = elapsed();
    activeSince = undefined;
  };
  const release = () => {
    runners.without.dispose();
    runners.with.dispose();
  };
  const publish = (side: Side, change: Partial<ParserView>) => {
    frame = {
      ...frame,
      [side]: { ...frame[side], ...change, calls: [...calls[side].values()] },
    };
  };
  const countInput = (side: Side, text: string) =>
    publish(side, {
      parserBytes: frame[side].parserBytes + encoder.encode(text).length,
      parserCalls: frame[side].parserCalls + 1,
      lastInput: text,
    });
  const measureParser = <T>(side: Side, isDelta: boolean, run: () => T): T => {
    const started = now();
    try {
      return run();
    } finally {
      // The same event-processing boundary on both sides, including failures.
      // React, inspector bookkeeping, schema validation, and delays are outside.
      const duration = Math.max(0, now() - started);
      const phase = isDelta ? "deltaMs" : "lifecycleMs";
      publish(side, {
        parserMs: frame[side].parserMs + duration,
        [phase]: frame[side][phase] + duration,
      });
    }
  };

  return {
    snapshot: () => frame,
    play() {
      if (frame.canStep && activeSince === undefined) activeSince = now();
    },
    pause,
    elapsedMs: (side: Side) => frame[side].finishedAtMs ?? elapsed(),
    next(): ComparisonSnapshot {
      if (!frame.canStep) return frame;
      // Manual steps include their processing time, never time spent paused.
      const stepStarted = activeSince === undefined ? now() : undefined;
      const eventElapsed = () =>
        elapsed() + (stepStarted === undefined ? 0 : now() - stepStarted);
      const event = events[frame.index];
      const path = event.path.join("/");
      if (event.type === "part-start" && event.part.type === "tool-call") {
        idsByPath.set(path, event.part.toolCallId);
      }
      const id = idsByPath.get(path) ?? "unknown";
      const delta = event.type === "text-delta" ? event.textDelta : "";
      frame = {
        ...frame,
        index: frame.index + 1,
        sourceBytes: frame.sourceBytes + encoder.encode(delta).length,
        lastEvent: { type: event.type, id, text: delta },
        canStep: frame.index + 1 < events.length,
      };

      // One provider event, two real parsers. A failed side stops independently.
      const order: readonly Side[] =
        frame.index % 2 ? ["without", "with"] : ["with", "without"];
      for (const side of order) {
        if (frame[side].state === "error") continue;
        try {
          const runner = runners[side];
          if (event.type === "text-delta") {
            countInput(
              side,
              side === "without"
                ? (runner.calls.get(id)?.argsText ?? "") + delta
                : delta,
            );
          }
          measureParser(side, event.type === "text-delta", () => {
            if (side === "with" && event.type === "part-start")
              ensureStreamfoldReady();
            runner.push(event);
          });
          for (const call of runner.calls.values()) {
            const previous = calls[side].get(call.id);
            calls[side].set(call.id, {
              type: "tool-call",
              toolCallId: call.id,
              toolName: call.name,
              args: call.args,
              argsText: call.argsText,
              ...(call.complete
                ? {
                    result: previous?.result ?? resultFor(call.name, call.args),
                  }
                : {}),
            });
          }
          publish(side, {
            state: frame.canStep ? "running" : "complete",
            ...(!frame.canStep ? { finishedAtMs: eventElapsed() } : {}),
          });
        } catch (error) {
          if (side === "with") release();
          publish(side, {
            state: "error",
            errorEvent: frame.index,
            error: error instanceof Error ? error.message : String(error),
            finishedAtMs: eventElapsed(),
          });
        }
      }
      if (stepStarted !== undefined) playedMs += now() - stepStarted;
      if (!frame.canStep) {
        pause();
        release();
      }
      return frame;
    },
    cancel(): ComparisonSnapshot {
      if (frame.canStep && (frame.index > 0 || activeSince !== undefined)) {
        pause();
        for (const side of ["without", "with"] as const)
          if (frame[side].state === "running" || frame[side].state === "idle")
            publish(side, { state: "cancelled", finishedAtMs: elapsed() });
        frame = { ...frame, canStep: false };
      }
      release();
      return frame;
    },
    dispose() {
      pause();
      release();
      frame = { ...frame, canStep: false };
    },
    get activeStreams() {
      return runners.with.activeStreams;
    },
  };
}

export function comparisonMessages(
  frame: ComparisonSnapshot,
  side: Side,
): ThreadMessageLike[] {
  if (!frame.index) return [];
  const parser = frame[side];
  return [
    { id: "question", role: "user", content: scenarios[frame.scenario].prompt },
    {
      id: "answer",
      role: "assistant",
      content: [
        {
          type: "text",
          text:
            frame.scenario === "trip"
              ? "I’ll check the forecast and put together a trip plan."
              : "I'll check the sample forecast.",
        },
        ...parser.calls,
      ],
      status:
        parser.state === "error"
          ? { type: "incomplete", reason: "error", error: parser.error }
          : parser.state === "cancelled"
            ? { type: "incomplete", reason: "cancelled" }
            : parser.state === "complete"
              ? { type: "complete", reason: "stop" }
              : { type: "running" },
    },
  ];
}
