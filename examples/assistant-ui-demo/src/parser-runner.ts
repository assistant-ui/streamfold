import type { ToolCallMessagePart } from "@assistant-ui/react";
import type { AssistantStreamChunk } from "assistant-stream";
import {
  getPartialJsonObjectMeta,
  parsePartialJsonObject,
} from "assistant-stream/utils";
import { createStructuredStreamPool } from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";
import { ensureStreamfoldReady } from "./engine-warmup.ts";

export type ParserSide = "without" | "with";
export type ParsedCall = {
  id: string;
  name: string;
  argsText: string;
  args: ToolCallMessagePart["args"];
  complete: boolean;
};

// Both the live display and repeated benchmark use this same boundary:
// event routing, accumulated text, partial snapshots, and finalization.
// React updates, inspector counters, schema validation, and tools stay outside.
export function createParserRunner(side: ParserSide) {
  const pool =
    side === "with"
      ? createStructuredStreamPool<string>({ snapshots: "immutable" })
      : undefined;
  const adapter = pool ? assistantUI(pool) : undefined;
  const idsByPath = new Map<string, string>();
  const namesById = new Map<string, string>();
  const calls = new Map<string, ParsedCall>();
  return {
    calls,
    push(event: AssistantStreamChunk) {
      const path = event.path.join("/");
      if (event.type === "part-start" && event.part.type === "tool-call") {
        idsByPath.set(path, event.part.toolCallId);
        namesById.set(event.part.toolCallId, event.part.toolName);
      }
      const id = idsByPath.get(path)!;
      const delta = event.type === "text-delta" ? event.textDelta : "";
      if (adapter) {
        if (event.type === "part-start" && event.part.type === "tool-call")
          ensureStreamfoldReady();
        for (const update of adapter.pushAll(event)) {
          const previous = calls.get(update.id);
          calls.set(update.id, {
            id: update.id,
            name: namesById.get(update.id)!,
            argsText: (previous?.argsText ?? "") + delta,
            args: (update.partialValue ?? {}) as ParsedCall["args"],
            complete: update.type === "complete",
          });
        }
      } else if (
        event.type === "part-start" &&
        event.part.type === "tool-call"
      ) {
        calls.set(id, {
          id,
          name: event.part.toolName,
          argsText: "",
          args: {},
          complete: false,
        });
      } else if (event.type === "text-delta") {
        const previous = calls.get(id)!;
        const argsText = previous.argsText + delta;
        calls.set(id, {
          ...previous,
          argsText,
          args: parsePartialJsonObject(argsText) ?? previous.args,
        });
      } else if (event.type === "tool-call-args-text-finish") {
        const previous = calls.get(id)!;
        if (getPartialJsonObjectMeta(previous.args)?.state !== "complete")
          throw new Error(
            "Argument stream ended without a complete JSON object.",
          );
        calls.set(id, { ...previous, complete: true });
      }
    },
    dispose() {
      if (pool) for (const id of pool.activeIds) pool.abort(id);
    },
    get activeStreams() {
      return pool?.size ?? 0;
    },
  };
}
