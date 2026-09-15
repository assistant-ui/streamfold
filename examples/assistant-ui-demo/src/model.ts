import type {
  ChatModelRunResult,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import { readStructured, isStructuredStreamError } from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";
import { resultFor } from "./tool-data.ts";
export {
  weatherSchema,
  type WeatherArgs,
  type WeatherResult,
} from "./tool-data.ts";
import { fixtureEvents, type Scenario } from "./fixtures.ts";

export type RunState =
  | "idle"
  | "streaming"
  | "complete"
  | "cancelled"
  | "error";
export type TraceEntry = {
  sequence: number;
  direction: "in" | "out";
  type: string;
  id: string;
  text: string;
};
export type CallView = {
  id: string;
  args: unknown;
  raw: string;
  complete: boolean;
};
export type Trace = {
  state: RunState;
  entries: TraceEntry[];
  calls: CallView[];
  inputCount: number;
  outputCount: number;
  bytes: number;
  sourceClosed: boolean;
  error?: string;
};
export const emptyTrace = (): Trace => ({
  state: "idle",
  entries: [],
  calls: [],
  inputCount: 0,
  outputCount: 0,
  bytes: 0,
  sourceClosed: false,
});

function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function* runFixture({
  scenario,
  signal,
  interval = 110,
  onTrace = () => {},
}: {
  scenario: Scenario;
  signal: AbortSignal;
  interval?: number;
  onTrace?: (trace: Trace) => void;
}): AsyncGenerator<ChatModelRunResult, void> {
  let trace = emptyTrace();
  const calls = new Map<string, ToolCallMessagePart>();
  const idsByPath = new Map<string, string>();
  const namesById = new Map<string, string>();
  const rawById = new Map<string, string>();
  const completed = new Set<string>();
  const publish = (change: Partial<Trace> = {}) => {
    trace = {
      ...trace,
      ...change,
      calls: Array.from(calls, ([id, call]) => ({
        id,
        args: call.args,
        raw: rawById.get(id) ?? "",
        complete: completed.has(id),
      })),
    };
    onTrace(trace);
  };
  const log = (entry: Omit<TraceEntry, "sequence">) => {
    trace = {
      ...trace,
      entries: [
        ...trace.entries,
        { ...entry, sequence: trace.entries.length + 1 },
      ],
    };
  };
  async function* source() {
    try {
      for (const event of fixtureEvents(scenario)) {
        await delay(interval, signal);
        const path = event.path.join("/");
        if (event.type === "part-start" && event.part.type === "tool-call") {
          idsByPath.set(path, event.part.toolCallId);
          namesById.set(event.part.toolCallId, event.part.toolName);
        }
        const id = idsByPath.get(path) ?? "unknown";
        const text = event.type === "text-delta" ? event.textDelta : "";
        if (text) rawById.set(id, (rawById.get(id) ?? "") + text);
        log({ direction: "in", type: event.type, id, text });
        publish({
          inputCount: trace.inputCount + 1,
          bytes: trace.bytes + new TextEncoder().encode(text).length,
        });
        yield event;
      }
    } finally {
      publish({ sourceClosed: true });
    }
  }
  const content = (summary?: string): ChatModelRunResult["content"] => [
    {
      type: "text",
      text:
        scenario === "trip"
          ? "I’ll check the forecast and put together a trip plan."
          : "I'll check the sample forecast.",
    },
    ...calls.values(),
    ...(summary ? [{ type: "text" as const, text: summary }] : []),
  ];
  publish({ state: "streaming" });
  try {
    signal.throwIfAborted();
    yield { content: content() };
    for await (const update of readStructured(source(), {
      integration: assistantUI,
      limits: { snapshots: "immutable" },
      signal,
    })) {
      const id = String(update.id);
      const args = update.partialValue ?? {};
      if (typeof args !== "object" || args === null || Array.isArray(args))
        throw new Error("Expected an object for tool arguments");
      const toolName = namesById.get(id)!;
      let result: ReturnType<typeof resultFor> | undefined;
      if (update.type === "complete") {
        result = resultFor(toolName, update.value);
        completed.add(id);
      }
      calls.set(id, {
        type: "tool-call",
        toolCallId: id,
        toolName,
        args: args as ToolCallMessagePart["args"],
        argsText: rawById.get(id) ?? "",
        ...(result ? { result } : {}),
      });
      log({
        direction: "out",
        type: update.type,
        id,
        text: JSON.stringify(args),
      });
      publish({ outputCount: trace.outputCount + 1 });
      yield { content: content() };
    }
    publish({ state: "complete" });
    yield {
      content: content(
        scenario === "trip"
          ? "Your sample trip is ready. Switch days in the itinerary or explore the forecast chart. The stays and prices are fictional examples."
          : scenario === "parallel"
            ? "The sample forecast is 17 C in San Francisco and 20 C in Oakland."
            : "The sample forecast is 17 C and partly cloudy. Bring a light layer near the water.",
      ),
      status: { type: "complete", reason: "stop" },
    };
  } catch (error) {
    if (signal.aborted) {
      publish({ state: "cancelled" });
      return;
    }
    const message = isStructuredStreamError(error)
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
    publish({ state: "error", error: message });
    yield {
      content: content(),
      status: { type: "incomplete", reason: "error", error: message },
    };
  } finally {
    if (signal.aborted) publish({ state: "cancelled" });
  }
}
