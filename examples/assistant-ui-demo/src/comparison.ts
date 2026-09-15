import type {
  ThreadMessageLike,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import {
  getPartialJsonObjectMeta,
  parsePartialJsonObject,
} from "assistant-stream/utils";
import { createStructuredStreamPool } from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";
import { fixtureEvents, scenarios, type Scenario } from "./fixtures.ts";
import { resultFor } from "./tool-data.ts";

export type Side = "without" | "with";
type SideState = "idle" | "running" | "complete" | "cancelled" | "error";
export type ParserView = {
  state: SideState;
  calls: readonly ToolCallMessagePart[];
  parserBytes: number;
  parserCalls: number;
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
  lastInput: "",
});

export function createComparison(scenario: Scenario) {
  const events = fixtureEvents(scenario);
  const pool = createStructuredStreamPool<string>({ snapshots: "immutable" });
  const stream = assistantUI(pool);
  const idsByPath = new Map<string, string>();
  const namesById = new Map<string, string>();
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
  const release = () => {
    for (const id of pool.activeIds) pool.abort(id);
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

  return {
    snapshot: () => frame,
    next(): ComparisonSnapshot {
      if (!frame.canStep) return frame;
      const event = events[frame.index];
      const path = event.path.join("/");
      if (event.type === "part-start" && event.part.type === "tool-call") {
        idsByPath.set(path, event.part.toolCallId);
        namesById.set(event.part.toolCallId, event.part.toolName);
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
      for (const side of ["without", "with"] as const) {
        if (frame[side].state === "error") continue;
        try {
          if (side === "without") {
            if (
              event.type === "part-start" &&
              event.part.type === "tool-call"
            ) {
              calls.without.set(id, {
                type: "tool-call",
                toolCallId: id,
                toolName: event.part.toolName,
                args: {},
                argsText: "",
              });
            } else if (event.type === "text-delta") {
              const call = calls.without.get(id)!;
              const argsText = call.argsText + delta;
              countInput(side, argsText);
              const args = parsePartialJsonObject(argsText);
              calls.without.set(id, {
                ...call,
                argsText,
                args: args ?? call.args,
              });
            } else if (event.type === "tool-call-args-text-finish") {
              const call = calls.without.get(id)!;
              if (getPartialJsonObjectMeta(call.args)?.state !== "complete")
                throw new Error(
                  "Argument stream ended without a complete JSON object.",
                );
              calls.without.set(id, {
                ...call,
                result: resultFor(call.toolName, call.args),
              });
            }
          } else {
            if (event.type === "text-delta") countInput(side, delta);
            for (const update of stream.pushAll(event)) {
              const previous = calls.with.get(update.id);
              calls.with.set(update.id, {
                type: "tool-call",
                toolCallId: update.id,
                toolName: namesById.get(update.id)!,
                args: (update.partialValue ??
                  {}) as ToolCallMessagePart["args"],
                argsText: (previous?.argsText ?? "") + delta,
                ...(update.type === "complete"
                  ? {
                      result: resultFor(
                        namesById.get(update.id)!,
                        update.value,
                      ),
                    }
                  : {}),
              });
            }
          }
          publish(side, { state: frame.canStep ? "running" : "complete" });
        } catch (error) {
          if (side === "with") release();
          publish(side, {
            state: "error",
            errorEvent: frame.index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!frame.canStep) release();
      return frame;
    },
    cancel(): ComparisonSnapshot {
      if (frame.canStep && frame.index > 0) {
        for (const side of ["without", "with"] as const)
          if (frame[side].state === "running")
            publish(side, { state: "cancelled" });
        frame = { ...frame, canStep: false };
      }
      release();
      return frame;
    },
    dispose() {
      release();
      frame = { ...frame, canStep: false };
    },
    get activeStreams() {
      return pool.size;
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
