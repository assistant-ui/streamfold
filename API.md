# API reference

Streamfold is ESM-only. Import the protocol-neutral API from `streamfold` or an
event adapter from an integration subpath.

## Core factories

| API | Returns | Purpose |
| --- | --- | --- |
| `createStructuredStream(options?)` | `IncrementalJsonScanner` | Parse one JSON stream |
| `createStructuredStream(integration)` | `EventStructuredStream` | Compose an event adapter |
| `createStructuredStreamPool(options?)` | `StructuredStreamPool` | Track interleaved streams by ID |

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

`push(event)` returns an update for handled events and `undefined` for unrelated
events. `finish()` closes active calls and returns all completed calls.

See [MIGRATION.md](MIGRATION.md) for accepted event shapes and provider examples.
