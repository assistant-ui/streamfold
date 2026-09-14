# API reference

Streamfold is ESM-only. Import the protocol-neutral API from `streamfold` or an
event adapter from an integration subpath.

## Core factories

| API | Returns | Purpose |
| --- | --- | --- |
| `createStructuredStream(options?)` | `IncrementalJsonScanner` | Parse one JSON stream |
| `createStructuredStream(integration)` | Adapter's stream type | Compose an event adapter |
| `createStructuredStreamPool(options?)` | `StructuredStreamPool` | Track interleaved streams by ID |

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

## Event integrations

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

See [MIGRATION.md](MIGRATION.md) for accepted event shapes and provider examples.
