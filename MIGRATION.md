# Migration guide

Use Streamfold after your provider has decoded its HTTP or SSE response and
before partial tool input enters application state:

```text
decoded tool-call events → Streamfold → store/runtime/UI
```

Pass JSON argument deltas, not raw response bodies or SSE frames.

## 1. Install

```bash
pnpm add streamfold
```

Streamfold is ESM-only. Its Rust/Wasm engine is bundled, so projects do not
need Rust, native build tools, or provider SDK dependencies.

## 2. Choose an entry point

| Project shape | Use |
| --- | --- |
| One isolated JSON stream | `createStructuredStream()` |
| Interleaved tool calls | `createStructuredStreamPool()` |
| Decoded SDK events | An integration subpath |
| Unsupported event protocol | A small wrapper around the pool |

## 3. Replace repeated parsing

Many implementations append each delta and reparse the complete prefix:

```ts
let text = "";

function append(delta: string) {
  text += delta;
  return parsePartialJson(text);
}
```

Replace that accumulator with one retained parser:

```ts
import { createStructuredStream } from "streamfold";

const input = createStructuredStream();

function append(delta: string) {
  return input.push(delta).partialValue;
}

function finish() {
  const final = input.finish().partialValue;
  input.dispose();
  return final;
}
```

Feed only new deltas. `partialValue` is a live value updated in place; reactive
stores can apply `changes` instead to consume compact `set`, `append`, and
`complete` patches.

## 4. Handle concurrent calls

Use one pool when tool-call deltas can be interleaved:

```ts
import { createStructuredStreamPool } from "streamfold";

const inputs = createStructuredStreamPool();

function onToolEvent(event: ToolEvent) {
  if (event.type === "start") {
    return inputs.start(event.id);
  }
  if (event.type === "delta") {
    return inputs.push(event.id, event.delta);
  }
  if (event.type === "end") {
    return inputs.finish(event.id);
  }
  if (event.type === "abort") {
    inputs.abort(event.id);
  }
}
```

Create one pool per upstream response or session. Call `finish(id)` on normal
completion and `abort(id)` when a call is cancelled.

## 5. Use an SDK integration

Import the adapter matching your decoded event stream:

| Event source | Import |
| --- | --- |
| assistant-stream / assistant-ui | `streamfold/assistant-ui` |
| Vercel AI SDK | `streamfold/vercel-ai` |
| OpenAI Responses | `streamfold/openai` |
| Anthropic Messages | `streamfold/anthropic` |
| Gemini Interactions | `streamfold/gemini` |
| LangChain message chunks | `streamfold/langchain` |
| AG-UI events | `streamfold/ag-ui` |

Every adapter follows the same pattern:

```ts
import { createStructuredStream } from "streamfold/assistant-ui";

const toolInputs = createStructuredStream();

for await (const event of decodedEvents) {
  const update = toolInputs.push(event);
  if (update) {
    updateToolInput(update.id, update.partialValue, update.changes);
  }
}

const completedCalls = toolInputs.finish();
```

Initialize Streamfold in the transport or runtime layer. UI components should
receive partial values or patches rather than create parsers during render.

### assistant-stream / assistant-ui internals

The adapter translates assistant-stream events into one pool entry per tool
call. It uses `path` to associate later deltas with the `toolCallId` announced
at the start:

| Decoded event | Streamfold action |
| --- | --- |
| `part-start` with a `tool-call` part | Start `toolCallId` and remember its `path` |
| `text-delta` | Push `textDelta` to the call at that `path` |
| `tool-call-args-text-finish` | Finish that call and remove its path mapping |
| Response completion | Finish any calls still active |

When migrating assistant-stream itself, replace the internal hot path that
appends a delta and reparses the full accumulated argument text. Keep its
public events, final validation, tool execution, error handling, and UI state
contract unchanged. The parser belongs in the stream reader or runtime, not in
a React component.

For explicit cancellation, create the adapter with a shared pool and call
`pool.abort(toolCallId)`. An adapter error aborts every active call.

`assistant-stream` remains a development-only dependency in this repository so
the conformance suite can compare behavior with its existing partial parser.
The published `streamfold/assistant-ui` adapter imports no assistant-stream or
assistant-ui runtime code; it depends only on the event shape above.

## 6. Add an unsupported protocol

Map its start, delta, end, and abort events to a pool. Depend only on the event
fields you need; provider packages do not need to become runtime dependencies.

```ts
import { createStructuredStreamPool } from "streamfold";

export function createMyProtocolStream() {
  const pool = createStructuredStreamPool();

  return {
    push(event: MyEvent) {
      if (event.type === "tool-start") return pool.start(event.id);
      if (event.type === "tool-delta") {
        return pool.push(event.id, event.delta);
      }
      if (event.type === "tool-end") return pool.finish(event.id);
      if (event.type === "tool-abort") return pool.abort(event.id);
    },
    finish() {
      return pool.activeIds.map((id) => pool.finish(id));
    },
  };
}
```

## 7. Roll out safely

1. Run Streamfold beside the current parser in shadow mode.
2. Compare every final value with `JSON.parse(finalText)`.
3. Test nested input, Unicode splits, escapes, malformed JSON, interleaved
   calls, cancellation, and configured limits.
4. Measure with production-like payload and chunk sizes.
5. Switch the store or UI reader after mismatches stay at zero.
6. Remove the previous prefix parser.

Keep schema validation, authorization, and tool execution checks outside
Streamfold. For one-shot JSON or very large chunks, plain `JSON.parse` can be
simpler and faster.

See the [API reference](API.md) for limits and return types and the
[benchmark report](benchmarks/SDK_ADAPTER_REPORT.md) for measured crossover
points.
