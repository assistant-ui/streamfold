# Porting structured tool streams to Streamfold

Streamfold belongs after the provider protocol has been decoded and before
partial tool input enters application or UI state:

```text
model response
  → HTTP/SSE decoder
  → provider or assistant stream events
  → Streamfold integration
  → partial tool-input state
  → runtime/store/UI
```

Do not pass raw HTTP bodies or SSE frames to Streamfold. Pass only the JSON
argument deltas carried by decoded tool-call events.

## Choose the integration level

Use the core scanner when one call is already isolated:

```ts
import { createStructuredStream } from "streamfold";

const input = createStructuredStream();

input.push('{"query":"stream');
const update = input.push('fold"}');
const completed = input.finish();

console.log(update.partialValue);
console.log(completed.partialValue);
```

Use a pool when several calls can be interleaved:

```ts
import { createStructuredStreamPool } from "streamfold";

const inputs = createStructuredStreamPool();

inputs.start("call-1");
inputs.start("call-2");
inputs.push("call-1", '{"city":"Add');
inputs.push("call-2", '{"unit":"cel');
inputs.push("call-1", 'is Ababa"}');
inputs.push("call-2", 'sius"}');

const first = inputs.finish("call-1");
const second = inputs.finish("call-2");
```

Use an integration subpath when consuming an existing SDK event stream. The
integration owns the pool and maps start, delta, and end events for you.

## Replace repeated prefix parsing

A typical existing accumulator does this:

```ts
let argumentsText = "";

function append(delta: string) {
  argumentsText += delta;
  return parsePartialJsonObject(argumentsText);
}
```

That work grows with every delta because the complete prefix is scanned again.
Replace it with retained state:

```ts
import { createStructuredStream } from "streamfold";

const argumentsStream = createStructuredStream();

function append(delta: string) {
  return argumentsStream.push(delta);
}

function finish() {
  return argumentsStream.finish();
}
```

Use `update.partialValue` when the consumer needs a materialized partial value.
Use `update.changes` when a reactive store can apply `set`, `append`, and
`complete` patches directly. Applying patches avoids cloning the entire tool
input after every token.

## assistant-stream and assistant-ui

For an assistant-stream event source:

```ts
import { createStructuredStream } from "streamfold/assistant-ui";

const toolInputs = createStructuredStream();

for await (const event of assistantStream) {
  const update = toolInputs.push(event);
  if (update) {
    updateToolInput(update.id, update.partialValue, update.changes);
  }
}

const completedCalls = toolInputs.finish();
```

The adapter understands:

- `part-start` for a tool call;
- `text-delta` argument fragments;
- `tool-call-args-text-finish`.

When porting assistant-stream itself, replace the per-tool
`accumulatedText → parsePartialJsonObject(accumulatedText)` hot path in the
tool-call reader or accumulator. Keep assistant-stream's public events
unchanged and place one Streamfold parser behind each tool-call ID. This lets
assistant-ui benefit without adding parsing logic to React components.

For an application-level assistant-ui integration, initialize Streamfold in
the transport/runtime layer. React should receive partial values or patches;
components should not create parsers during render.

## Vercel AI SDK

For `fullStream`:

```ts
import { createStructuredStream } from "streamfold/vercel-ai";

const toolInputs = createStructuredStream();

for await (const part of result.fullStream) {
  const update = toolInputs.push(part);
  if (update) updateToolInput(update.id, update.partialValue);
}

toolInputs.finish();
```

The same integration accepts UIMessage tool-input events using `toolCallId` and
`inputTextDelta`.

Port at the point where the current code appends a delta and calls
`parsePartialJson` on the complete accumulated input. Keep Vercel's stream
transport, tool schemas, validation, and final tool execution unchanged.
Streamfold replaces only incremental partial-value materialization.

## OpenAI Responses

```ts
import { createStructuredStream } from "streamfold/openai";

const toolInputs = createStructuredStream();

for await (const event of responseEvents) {
  const update = toolInputs.push(event);
  if (update) updateToolInput(update.id, update.partialValue);
}

toolInputs.finish();
```

The adapter maps function-call output items, argument delta events, and argument
completion events. It accepts a completion event containing full arguments
even when no earlier start event was observed.

## Anthropic Messages

```ts
import { createStructuredStream } from "streamfold/anthropic";

const toolInputs = createStructuredStream();

for await (const event of messageEvents) {
  const update = toolInputs.push(event);
  if (update) updateToolInput(update.id, update.partialValue);
}

toolInputs.finish();
```

The adapter tracks `tool_use` and `server_tool_use` blocks by content index and
consumes `input_json_delta.partial_json`.

## Gemini Interactions

```ts
import { createStructuredStream } from "streamfold/gemini";

const toolInputs = createStructuredStream();

for await (const event of interactionEvents) {
  const update = toolInputs.push(event);
  if (update) updateToolInput(update.id, update.partialValue);
}

toolInputs.finish();
```

The adapter tracks function-call steps by index, consumes partial argument
deltas, and completes active calls when the interaction completes.

## LangChain

```ts
import { createStructuredStream } from "streamfold/langchain";

const toolInputs = createStructuredStream();

for await (const messageChunk of modelStream) {
  const update = toolInputs.push(messageChunk);
  if (update) updateToolInput(update.id, update.partialValue);
}

const completedCalls = toolInputs.finish();
```

The adapter consumes `AIMessageChunk.tool_call_chunks` and handles interleaved
tool-call indexes.

## AG-UI

```ts
import { createStructuredStream } from "streamfold/ag-ui";

const toolInputs = createStructuredStream();

for await (const event of agUiEvents) {
  const update = toolInputs.push(event);
  if (update) updateToolInput(update.id, update.partialValue);
}

toolInputs.finish();
```

The mapping is direct: `TOOL_CALL_START`, `TOOL_CALL_ARGS`, and
`TOOL_CALL_END`.

## Add an unsupported protocol

Keep provider packages out of Streamfold. Depend only on structural event
fields and map the protocol to a core pool:

```ts
import { createStructuredStreamPool } from "streamfold";

export function createMyProtocolStream() {
  const pool = createStructuredStreamPool();

  return {
    push(event: MyEvent) {
      if (event.type === "tool-start") {
        return pool.start(event.id);
      }
      if (event.type === "tool-delta") {
        return pool.push(event.id, event.delta);
      }
      if (event.type === "tool-end") {
        return pool.finish(event.id);
      }
    },
    finish() {
      return pool.activeIds.map((id) => pool.finish(id));
    },
  };
}
```

An integration needs only:

1. a stable call ID;
2. a start signal or lazy start rule;
3. ordered argument deltas;
4. a completion signal;
5. abort/error cleanup.

## Roll out safely

1. Run Streamfold in shadow mode beside the existing parser.
2. Compare every final Streamfold value with `JSON.parse(finalText)`.
3. Compare partial values on representative nested, Unicode, escape, and
   malformed-input traces.
4. Test interleaved calls, missing starts, completion-only events, aborts, size
   limits, and depth limits.
5. Measure with production-like payload and chunk distributions.
6. Switch the partial UI/store reader behind a feature flag.
7. Remove the old accumulated-prefix parser after mismatch telemetry stays at
   zero.

The repository conformance suite already covers assistant-stream fixtures,
Vercel partial values, arbitrary chunk boundaries, Unicode surrogate splits,
malformed JSON, and all bundled event integrations.

## Preserve the performance gain

- Create one parser or pool per upstream response/session, not per render.
- Feed only new deltas; never resend the complete accumulated prefix.
- Do not clone the complete partial value after every delta when patches can
  update the store.
- Batch UI notifications independently from parser updates when token rates
  are high.
- Call `finish()` at protocol completion and `abort()` when a call is
  cancelled.
- Keep `maxBytes`, `maxDepth`, and `maxActiveStreams` appropriate for untrusted
  model output.

Streamfold is most useful for structured values delivered in many small
fragments. For one-shot JSON or large chunks, a final `JSON.parse` is simpler
and can be faster. See [the published benchmark report](benchmarks/SDK_ADAPTER_REPORT.md)
for measured crossover points.
