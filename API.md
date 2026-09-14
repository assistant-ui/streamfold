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

Limits must be positive safe integers no greater than `4294967295`.

## `IncrementalJsonScanner`

| Member | Description |
| --- | --- |
| `push(chunk)` | Process the next JSON fragment and return its state |
| `finish()` | Validate and finalize the JSON document |
| `getFieldState(path)` | Return `"partial"` or `"complete"` for a path |
| `dispose()` | Release the Wasm parser |
| `value` | Current live partial value |
| `state` | Current state with an empty `changes` list |
| `backend` | Always `"rust-wasm"` |

A path is an array of object keys and array indexes. Use `[]` for the root.
Call `dispose()` when abandoning a scanner before completion.

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
| `partialValue` | Live partial JSON value, updated in place |
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
Updates retain the core API's live `partialValue` semantics, including within a
batch; consume `changes` for operation-by-operation reactive updates.

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
| Source, mapper, parser, or finalization throws | Propagate the error and dispose active parsers |
| Consumer breaks or throws | Close the source iterator and dispose without finalizing unfinished calls |

The helper does not pull another source event until the current batch has been
consumed. Results have the same live `partialValue` semantics as the manual API;
they are not immutable snapshots. Use `changes` when applying individual
updates to a reactive store. A final result has `value` and `text`; `complete`
alone describes JSON parser state and does not mean a call has ended.

Stopping iteration uses the source's iterator cleanup. It cannot interrupt an
arbitrary pending source read or guarantee cancellation of the underlying network
request. Pass cancellation signals to your SDK or transport when needed; this
helper does not accept an `AbortSignal`.

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

Each integration exports `createStructuredStream(pool?)`, its event type, and a
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

See [MIGRATION.md](MIGRATION.md) for accepted event shapes and provider examples.
