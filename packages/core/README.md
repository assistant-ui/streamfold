# streamfold

Incremental structured state for streamed AI tool calls.

Streamfold retains JSON parser and value state across deltas. Its embedded
Rust/WebAssembly engine emits compact patches and works in Node.js 20+ and
modern browsers without native build tools or provider SDK dependencies.
It compiles Wasm at runtime, so it does not run in edge isolates such as
Cloudflare Workers and Vercel Edge Functions, or on pages whose
Content-Security-Policy blocks Wasm; those fail with
[`WASM_COMPILE_BLOCKED`](https://github.com/assistant-ui/streamfold/blob/main/API.md#errors-and-diagnostics).

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
forward it through `limits`. Immutable mode copies the arrays and objects on
each push's changed path, so it costs more as arrays grow; see the
[measurements](https://github.com/assistant-ui/streamfold/blob/main/API.md#immutable-snapshots)
before using it for long arrays.

Chunks must contain well-formed Unicode. Valid surrogate pairs may span chunks;
raw unpaired UTF-16 code units fail with `INVALID_CHUNK` instead of being silently
replaced during UTF-8 encoding. Use JSON Unicode escapes for unpaired code units
(as produced by `JSON.stringify`).

Use `streamfold/assistant-ui`, `streamfold/vercel-ai`, `streamfold/openai`,
`streamfold/anthropic`, `streamfold/cohere`, `streamfold/bedrock`,
`streamfold/pi` (unreleased, Pi native events), `streamfold/gemini`, `streamfold/langchain`, or `streamfold/ag-ui` for decoded
SDK events. Integrations use structural event types and do not load provider
SDKs. The unreleased `streamfold/openrouter` subpath reads native OpenRouter
chat tool calls.

The unreleased `streamfold/openai-agents` entry accepts a streamed Runner result
from `@openai/agents` 0.22.0. Use `readStructured(run, { integration: openAIAgents })`
for Chat Completions or Responses function arguments.

To opt into assistant-stream's shared parser, import
`initializeAssistantStream` and `disableAssistantStream` from
`streamfold/assistant-ui`. Check the initializer's boolean result; it returns
false if the optional host registration API or runtime support is unavailable.
Call `disableAssistantStream()` during application shutdown or hot-module
disposal. It removes only this module's registration, cancels pending
initialization, and permits re-enabling later. Existing parsers remain usable.

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
Readable streams are consumed through `getReader()` even without an abort
signal or native async-iterator support.
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
