# API reference

Streamfold is ESM-only. Import the protocol-neutral API from `streamfold` or an
event adapter from an integration subpath.

## Core factories

| API | Returns | Purpose |
| --- | --- | --- |
| `createStructuredStream(options?)` | `IncrementalJsonScanner` | Parse one JSON stream |
| `createStructuredStream(integration)` | Adapter's stream type | Compose an event adapter |
| `createStructuredStreamPool(options?)` | `StructuredStreamPool` | Track interleaved streams by ID |
| `defineAdapter(mapEvent)` | `StructuredStreamAdapter` | Build an adapter for custom decoded events |
| `readStructured(events, { adapter, limits? })` | `AsyncGenerator` | Consume events with automatic finalization and cleanup |

### Options

| Option | Default | Applies to |
| --- | ---: | --- |
| `maxBytes` | 16 MiB | One stream |
| `maxDepth` | 128 | One stream |
| `maxActiveStreams` | 256 | A pool |
| `snapshots` | `"live"` | A scanner or every stream in a pool |

Limits must be positive safe integers no greater than `4294967295`.
`snapshots` accepts `"live"` or `"immutable"`; invalid modes throw `TypeError`.

## `IncrementalJsonScanner`

| Member | Description |
| --- | --- |
| `push(chunk)` | Process the next JSON fragment and return its state |
| `finish()` | Validate and finalize the JSON document |
| `getFieldState(path)` | Return `"partial"` or `"complete"` for a path |
| `dispose()` | Release the Wasm parser |
| `value` | Current partial value, following the selected snapshot mode |
| `state` | Current state with an empty `changes` list |
| `backend` | Always `"rust-wasm"` |

A path is an array of object keys and array indexes. Use `[]` for the root.
Call `dispose()` when abandoning a scanner before completion.

Chunks contain Unicode text and are encoded as UTF-8. Valid surrogate pairs
can span pushes; raw unpaired UTF-16 code units throw `INVALID_CHUNK` rather
than being replaced with U+FFFD. Encode unpaired code units as JSON Unicode
escapes (for example, by using `JSON.stringify`) to preserve them losslessly.

## `StructuredStreamPool`

| Member | Description |
| --- | --- |
| `start(id, initialChunk?)` | Start a stream; duplicate IDs throw |
| `push(id, delta)` | Process a fragment for an active ID |
| `finish(id)` | Finalize, return `{ id, text, value, ...state }`, and remove the stream |
| `getFieldState(id, path)` | Read completion state for a field |
| `abort(id)` | Dispose and remove a stream; returns whether it existed |
| `has(id)` | Test whether an ID is active |
| `activeIds` | Snapshot of active IDs |
| `size` | Number of active streams |

Syntax and limit failures are terminal. A failed pool entry is removed
automatically.

## Stream state

Every update includes:

| Field | Description |
| --- | --- |
| `partialValue` | Live partial JSON value by default; frozen snapshot in immutable mode |
| `changes` | Patches emitted by the latest operation |
| `bytesSeen` | UTF-8 bytes processed |
| `depth` | Current parser depth |
| `complete` | Whether the root value is complete |
| `inString` | Whether the parser is inside a string |

Patches have one of three shapes:

```ts
{ op: "set", path, value }
{ op: "append", path, value }
{ op: "complete", path }
```

`set` creates or replaces a value, `append` extends a string, and `complete`
marks a path as structurally complete.

## Event integrations

### Immutable snapshots

```ts
const stream = createStructuredStream({ snapshots: "immutable" });
const first = stream.push('{"city":"San').partialValue;
const second = stream.push(' Francisco"}').partialValue;
// first: { city: "San" }, second: { city: "San Francisco" }
stream.finish();
stream.dispose();
```

Objects and arrays in `partialValue`, `scanner.value`, and pool completion
`value` are deeply frozen in immutable mode. Earlier values never change.
Changed paths get new containers; unchanged branches retain identity. An
update containing only completion patches can retain the same root identity,
so use `changes` or lifecycle updates when observing completion.

Each affected container is copied at most once per parser operation, not once
per patch. Wide arrays/objects still cost more to copy as they grow. Prefer
default live mode plus `changes` when minimizing allocations matters. The
snapshot setting does not freeze the update envelope or the patch list.

### Custom adapters

`defineAdapter(mapEvent)` returns a factory. Calling that factory with optional
pool limits creates an independent session with `pushAll`, `finish`, and
`dispose`. `createStructuredStream(adapter)` also creates a session using the
default limits.

```ts
import { defineAdapter } from "streamfold";

type WeatherEvent =
  | { kind: "begin" | "done"; id: string }
  | { kind: "piece"; id: string; text: string }
  | { kind: "ping" };

const weatherAdapter = defineAdapter((event: WeatherEvent) => {
  switch (event.kind) {
    case "begin":
      return [{ type: "start", id: event.id }];
    case "piece":
      return [{ type: "delta", id: event.id, text: event.text }];
    case "done":
      return [{ type: "end", id: event.id }];
    default:
      return [];
  }
});

const stream = weatherAdapter({ maxActiveStreams: 8 });
try {
  for await (const event of events) {
    for (const update of stream.pushAll(event)) {
      renderToolInput(update.id, update.partialValue);
      if ("value" in update) console.log("Final:", update.value);
    }
  }
  for (const completed of stream.finish()) {
    renderToolInput(completed.id, completed.value);
  }
} finally {
  stream.dispose();
}
```

The mapper is synchronous and returns an array of operations in source order.
Return `[]` for ignored events, or multiple operations when an event contains
several calls or both a start and a fragment. IDs may be strings, numbers, or
another stable pool key. Keep mappers stateless: the factory isolates parser
state, not mutable variables captured by your function.

| Operation | Effect |
| --- | --- |
| `{ type: "start", id }` | Create a parser and emit its initial state |
| `{ type: "delta", id, text }` | Feed a JSON fragment and emit partial state |
| `{ type: "end", id }` | Validate JSON, emit a final `{ id, text, value, ...state }`, and release the parser |
| `{ type: "abort", id }` | Release an active parser without an update; unknown IDs are ignored |

`pushAll(event)` returns every update, in operation order, with a lifecycle
`type: "start" | "update" | "complete"`. Custom and SDK streams share this
update shape. Custom `finish()` results also have `type: "complete"`.
Start an ID before
sending deltas or ending it; duplicate starts and unknown delta/end IDs throw.
An ID can be reused after `end` or `abort`.

`finish()` finalizes **only remaining active calls** in their start order; it
does not repeat results already emitted by `end`. After successful finalization,
further `finish()` calls return `[]` and `pushAll` throws. `dispose()` is
idempotent and releases active parsers without validating their unfinished JSON.
A disposed session cannot be pushed or finalized.

Mapper, syntax, operation, and limit errors terminate the session and release all
its active parsers. The failing call throws without returning a partial batch;
subsequent `pushAll`/`finish` calls rethrow the failure. Disposal is still safe.
Values are live by default, including within a batch. Pass
`{ snapshots: "immutable" }` when calling a custom adapter factory to retain
stable frozen values, or consume `changes` for reactive updates.

The managed reader forwards the same option through `limits`, for either
factory contract: `{ adapter: weatherAdapter, limits: { snapshots: "immutable" } }`
or `{ integration: assistantUI, limits: { snapshots: "immutable" } }`.

### Adapter contract tests

The Node-only `streamfold/testing` entry exports `adapterContractTests` for
custom factories created with `defineAdapter`. It does not import a test runner
or add dependencies to the browser/runtime entry points.

```js
import test from "node:test"; // Or import { test } from "vitest".
import { defineAdapter } from "streamfold";
import { adapterContractTests } from "streamfold/testing";

const adapter = defineAdapter((event) => event.operations);
for (const { name, run } of adapterContractTests({
  adapter,
  encode: (operations) => [{ operations }],
})) {
  test(name, run);
}
```

Replace `encode` with a translation from the supplied ordered operations into
your protocol's decoded events. It returns an iterable of events, so a protocol
can split operations across events or put several in one event. The mapper and
encoder should be independently implemented; routing both through the same
translation can hide mistakes.

The nine cases check interleaved lifecycle updates, stable nested snapshots,
EOF without duplicate completions, abort and ID reuse, malformed JSON, missing
and duplicate calls, session isolation, limits, and managed early-exit cleanup.
They target the custom-adapter contract, not built-in SDK adapters with legacy
completion history. These are behavioral checks, not a memory-leak audit or a
substitute for tests using real provider fixtures and malformed protocol events.

### Managed consumption

`readStructured` drives the same adapter session as the manual example above.
Pass the factory returned by `defineAdapter`, not an already-created session:

```ts
import { readStructured } from "streamfold";

const events: WeatherEvent[] = [
  { kind: "begin", id: "weather" },
  { kind: "piece", id: "weather", text: '{"city":"San' },
  { kind: "piece", id: "weather", text: ' Francisco"}' },
  { kind: "done", id: "weather" },
];

// Reuses weatherAdapter from the custom-adapter example.
for await (const update of readStructured(events, {
  adapter: weatherAdapter,
  limits: { maxActiveStreams: 8, maxBytes: 1024 },
})) {
  console.log(update.id, update.partialValue);
  if ("value" in update) console.log("Final:", update.value);
}
```

The source can be a synchronous iterable, an async iterable from an SDK, or an
async-iterable `ReadableStream` of **decoded events**. Streamfold does not decode
HTTP bytes or SSE frames and does not start network requests.

| Situation | Behavior |
| --- | --- |
| Iteration starts | Create one fresh session with the supplied limits |
| An event arrives | Yield every `pushAll(event)` update in order |
| Source ends normally | Yield `finish()` results for any remaining calls, then dispose |
| Source, mapper, parser, or finalization throws | Preserve the original error, close the source, and dispose active parsers |
| Consumer breaks or throws | Close the source iterator and dispose without finalizing unfinished calls |

The helper does not pull another source event until the current batch has been
consumed. Results have the same live `partialValue` semantics as the manual API;
they are not immutable snapshots. Use `changes` when applying individual
updates to a reactive store. A final result has `value` and `text`; `complete`
alone describes JSON parser state and does not mean a call has ended.

Pass `signal: controller.signal` to stop a managed read, including a stalled
source read. Aborting rejects with `signal.reason`, immediately disposes active
parsers, and discards remaining batch updates without finalizing incomplete JSON.
A pre-aborted signal does not create a session or acquire the source.

For a `ReadableStream`, cancellation calls its reader's `cancel(reason)` and
releases the lock. For other iterables it requests `iterator.return()`; arbitrary
iterators may ignore that request or never settle. On abort, Streamfold does not
wait for that cleanup, and observes late rejections without replacing the abort
reason. Pass the same signal to the SDK or transport to stop network activity.
Without a signal, Streamfold still closes failed or abandoned sources and
releases reader locks, but waits for cleanup to settle.

For a built-in SDK integration, use `integration` instead of `adapter`:

```ts
import { readStructured } from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";

for await (const update of readStructured(assistantStream, {
  integration: assistantUI,
  limits: { maxActiveStreams: 8 },
})) {
  renderToolInput(update.id, update.partialValue);
  if (update.type === "complete") console.log(update.value);
}
```

Choose exactly one factory: `adapter` for a `defineAdapter` factory, or
`integration` for a built-in SDK factory. Both return the same lifecycle update
shape. The helper owns the integration's pool and finalizes only pending calls,
without replaying SDK completion history, even when a call ID is reused.
Cleanup and backpressure rules above apply to both paths. Custom integration
factories must use the supplied pool and return completion history with newly
finalized calls appended, matching the built-in contract.

### Built-in SDK adapters

Each integration exports `createStructuredStream(pool?, options?)`, its event type, and a
composable integration value:

| Import | Integration export |
| --- | --- |
| `streamfold/assistant-ui` | `assistantUI` |
| `streamfold/vercel-ai` | `vercelAI` |
| `streamfold/openai` | `openAI` |
| `streamfold/anthropic` | `anthropic` |
| `streamfold/gemini` | `gemini` |
| `streamfold/langchain` | `langchain` |
| `streamfold/ag-ui` | `agUI` |

| Method | Returns |
| --- | --- |
| `pushAll(event)` | All lifecycle updates caused by this event, in order; `[]` for ignored events |
| `push(event)` | Legacy single update or `undefined`; some multi-call events return only the last update |
| `finish()` | Closes remaining calls and returns all completed calls, including those completed earlier |

Choose **one** push method per event; calling both consumes it twice. `pushAll`
is available on every built-in adapter (`BatchEventStructuredStream`). Existing
custom implementations of `EventStructuredStream` need not implement it.

Each `pushAll` result has `type: "start" | "update" | "complete"` in addition to
the existing stream state and `id`. A `"start"` can already contain an initial
value. A `"complete"` also has validated JSON `text` and final `value`.
`complete: true` in stream state only means the JSON root is complete; it does
not mean the provider has ended its arguments. No lifecycle update means that
a tool has executed or its arguments satisfy a schema.

LangChain has no per-call end event in this adapter, so its remaining calls
are finalized by `finish()`. The returned completion history is not a new batch
of lifecycle events; do not process already-seen completions twice.

Failures remain terminal and abort all active calls in the adapter's pool.
If an event changes several calls and then fails, `pushAll` throws without
returning a partial batch. It does not roll back previously returned live views.
Use a separate pool per response/session.

### Errors and diagnostics

```ts
import { createStructuredStreamPool, isStructuredStreamError } from "streamfold";
import { vercelAI } from "streamfold/vercel-ai";

const inputs = vercelAI(
  createStructuredStreamPool({ snapshots: "immutable" }),
  { onDiagnostic: (diagnostic) => console.warn(diagnostic) },
);

try {
  inputs.pushAll({ type: "tool-input-delta", id: "missing", delta: "{}" });
} catch (error) {
  if (isStructuredStreamError(error)) {
    console.error(error.code, error.id, error.adapter, error.eventType);
    // UNKNOWN_STREAM, missing, vercel-ai, tool-input-delta
  }
}
```

Streamfold annotates the original error, preserving `instanceof SyntaxError`,
`RangeError`, or `TypeError`. `isStructuredStreamError(error)` narrows it to
`StructuredStreamError`. Metadata:

| Field | Availability |
| --- | --- |
| `code` | Stable machine-readable category |
| `byteOffset` | Zero-based UTF-8 byte offset for Rust parser failures, not a JavaScript character index |
| `id`, `operation` | Pool call and operation, when known; scanners supply `operation` |
| `adapter`, `eventType` | Built-in adapter name and event type, when known; `finish()` has no event type |

Error codes include `UNEXPECTED_TOKEN`, `MISMATCHED_CLOSING`, `TRAILING_DATA`,
`EMPTY_INPUT`, `INCOMPLETE_JSON`, `INVALID_JSON`, `PARSER_ERROR`,
`MAX_BYTES_EXCEEDED`, `MAX_DEPTH_EXCEEDED`, `MAX_ACTIVE_STREAMS_EXCEEDED`,
`DUPLICATE_STREAM`, `UNKNOWN_STREAM`, `STREAM_DISPOSED`, `INVALID_CHUNK`,
`INVALID_OPTIONS`, and `INTEGRATION_ERROR`. Frozen upstream errors are rethrown
unchanged if metadata cannot be attached.

`onDiagnostic` is optional; nothing is logged by default. Diagnostics include
`code`, `message`, `adapter`, and relevant event/call context:

- `NO_TOOL_EVENTS`: emitted once at `finish()` after events were consumed but
  no calls matched. Text-only responses are valid; this is a debugging hint.
- `UNMATCHED_TOOL_EVENT`: a recognizable tool event lacks a matching ID/index
  or start. Unrelated text events are ignored.
- `STREAM_ERROR`: a terminal failure, with the original `error`.

Diagnostics do not attach event payloads or argument text. They do contain
IDs and original error messages; redact sensitive application identifiers in
your logger. Callback exceptions are ignored so logging cannot break parsing.

Custom factories accept the same callback in their options:
`weatherAdapter({ snapshots: "immutable", onDiagnostic })`. Custom diagnostics
use `adapter: "custom"` and preserve mapper/protocol failures as well as pool
errors. For managed consumption, pass `onDiagnostic` beside `adapter` or
`integration`; it is forwarded to the selected factory. Upstream iterator and
consumer errors still propagate unchanged and are not reported by adapter
diagnostics.

See [MIGRATION.md](MIGRATION.md) for accepted event shapes and provider examples.
