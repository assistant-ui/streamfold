# streamfold

Incremental structured state for streamed AI tool calls.

Streamfold retains JSON parser and value state across deltas. Its embedded
Rust/WebAssembly engine emits compact patches and works in Node.js 20+ and
modern browsers without native build tools or provider SDK dependencies.

## Install

```bash
npm install streamfold
```

## Quick start

```ts
import { createStructuredStream } from "streamfold";

const stream = createStructuredStream();
const update = stream.push('{"city":"San');

console.log(update.partialValue); // { city: "San" }

stream.push(' Francisco"}');
console.log(stream.getFieldState(["city"])); // "complete"

stream.finish();
stream.dispose();
```

Values are live by default. Use `createStructuredStream({ snapshots: "immutable" })`
for frozen snapshots that preserve earlier values and share unchanged branches.
Pools and custom adapter factories accept the same option; managed readers
forward it through `limits`.

Use `streamfold/assistant-ui`, `streamfold/vercel-ai`, `streamfold/openai`,
`streamfold/anthropic`, `streamfold/gemini`, `streamfold/langchain`, or
`streamfold/ag-ui` for decoded SDK events. Integrations use structural event
types and do not load provider SDKs.

For custom protocols, import `defineAdapter` from `streamfold`. Translate each
event into an array of `start`, `delta`, `end`, or `abort` operations. The returned
factory creates an independent session with `pushAll(event)`, `finish()`, and
`dispose()`. See the API reference for a complete switch-based example.

For automatic lifecycle management, use
`readStructured(events, { adapter, limits })` in a `for await` loop. It wraps the
same batch adapter, finalizes remaining calls at the end of the source, and
disposes on completion, failure, or early exit. `limits` is optional.
For a built-in SDK factory, use `{ integration: assistantUI, limits }` instead.
Both paths yield the same lifecycle updates without replaying completions.
Upstream failures close the iterator or reader while preserving the original
error, even when no abort signal is supplied.

Every built-in adapter supports `pushAll(event)`, returning all ordered
`start`, `update`, and `complete` updates, including multiple calls in one event.
Existing `push(event)` remains available. Call `finish()` at the stream boundary.

Pass `onDiagnostic` in a custom factory's options, as an SDK factory's second
argument, or beside the factory in `readStructured`. Errors preserve their
native categories and include structured codes and call context where known.

See the repository for the [API reference](https://github.com/assistant-ui/streamfold/blob/main/API.md),
[integration guide](https://github.com/assistant-ui/streamfold/blob/main/MIGRATION.md),
and [benchmarks](https://github.com/assistant-ui/streamfold#performance).

MIT © Streamfold contributors
