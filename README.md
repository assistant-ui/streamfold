# Streamfold

> Incremental structured state for AI streams.

[![npm](https://img.shields.io/npm/v/streamfold)](https://www.npmjs.com/package/streamfold)
[![CI](https://github.com/assistant-ui/streamfold/actions/workflows/ci.yml/badge.svg)](https://github.com/assistant-ui/streamfold/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Streamfold turns fragmented tool-call JSON into live partial values. Its
Rust/WebAssembly engine keeps parser state between deltas, avoiding a full
reparse after every chunk. The ESM API works in Node.js 20+ and modern browsers
without native build tools or provider SDK dependencies.
It compiles Wasm at runtime, so it does not run in edge isolates such as
Cloudflare Workers and Vercel Edge Functions, or on pages whose
Content-Security-Policy blocks Wasm; those fail with
[`WASM_COMPILE_BLOCKED`](API.md#errors-and-diagnostics).

## Install

```bash
pnpm add streamfold
```

## Quick start

```ts
import { createStructuredStream } from "streamfold";

const stream = createStructuredStream();

stream.push('{"city":"San');
const update = stream.push(' Francisco"}');

console.log(update.partialValue); // { city: "San Francisco" }
console.log(stream.getFieldState(["city"])); // "complete"

stream.finish();
stream.dispose();
```

`partialValue` is updated in place by default. For stable values to pass to
React or a store, opt into `createStructuredStream({ snapshots: "immutable" })`.
Earlier snapshots stay unchanged, and unchanged branches keep their identity.
Reactive stores can also apply the compact `set`, `append`, and `complete`
patches in `changes`.

Immutable mode is copy-on-write: each push copies the arrays and objects on
the changed path, so its cost grows with array length. Streaming 16,000 records
in 8-byte chunks took a 477 ms median with immutable snapshots and 81 ms with
live values on an Apple M1. See the
[measurements](API.md#immutable-snapshots) before choosing it for long arrays.

Call `prepareStreamfold()` while the app is idle to compile and cache the
embedded WebAssembly module asynchronously before first use. Scanner
construction remains synchronous.
See the [startup measurements](benchmarks/STARTUP_REPORT.md) for the scope and
limits of initialization improvements.

```ts
import { createStructuredStream, prepareStreamfold } from "streamfold";

await prepareStreamfold();
const stream = createStructuredStream();
```

Use a pool for interleaved tool calls:

```ts
import { createStructuredStreamPool } from "streamfold";

const streams = createStructuredStreamPool();

streams.start("call-1");
streams.push("call-1", '{"query":"stream');
streams.push("call-1", 'fold"}');

console.log(streams.finish("call-1").value);
// { query: "streamfold" }
```

Streams default to 16 MiB, nesting depth 128, and 256 active calls per pool.
All limits are configurable.

## Integrations

Streamfold includes isolated adapters for decoded SDK events:

| Import | Event source |
| --- | --- |
| `streamfold/assistant-ui` | assistant-stream |
| `streamfold/vercel-ai` | Vercel AI SDK |
| `streamfold/mistral` | Mistral `chat.stream` via `mistralChat` (unreleased) |
| `streamfold/openai` | OpenAI Responses; Chat Completions via `openAIChatCompletions` (since 0.1.20) |
| `streamfold/anthropic` | Anthropic Messages |
| `streamfold/cohere` | Cohere v2 Chat |
| `streamfold/bedrock` | Amazon Bedrock ConverseStream |
| `streamfold/gemini` | Gemini Interactions |
| `streamfold/langchain` | LangChain message chunks |
| `streamfold/ag-ui` | AG-UI events |

```ts
import { createStructuredStreamPool } from "streamfold";
import { createStructuredStream } from "streamfold/assistant-ui";

const toolInputs = createStructuredStream(
  createStructuredStreamPool({ snapshots: "immutable" }),
);

for await (const event of assistantStream) {
  for (const update of toolInputs.pushAll(event)) {
    renderToolInput(update.id, update.partialValue);
    // update.type is "start", "update", or "complete".
  }
}

const completedCalls = toolInputs.finish();
```

To enable Streamfold inside assistant-stream's shared tool-argument parser, use
an assistant-stream build that exposes `registerJsonParserBackend` and initialize
once before starting streams:

```ts
import { initializeAssistantStream } from "streamfold/assistant-ui";

const enabled = await initializeAssistantStream();
```

This is an explicit opt-in. Merely importing `streamfold/assistant-ui` keeps its
existing event adapter behavior and does not register anything. Initialization
returns `false` if the optional assistant-stream peer is absent, lacks the
registration API, or WebAssembly/finalization support is unavailable. Older
assistant-stream versions keep native parsing. Concurrent or repeated calls
share initialization; a failed attempt can be retried.

Call `disableAssistantStream()` from `streamfold/assistant-ui` when the owning
application or hot module stops. It synchronously unregisters this module's
backend and cancels pending initialization (which then resolves to `false`).
Repeated calls are safe, and a later `initializeAssistantStream()` can re-enable
it. Existing parsers and registrations owned by other modules keep their backend.
Hot reloads must run the old module's cleanup; reimporting alone does not unregister it.

Once enabled, new shared parsers use Streamfold across copies of assistant-stream
in the same JavaScript realm. Existing parsers retain their backend. Snapshots,
partial-field metadata, accepted text, independent branches, and native fallback
are owned by assistant-stream. Unsupported prefixes fall back; completed and rejected WASM
sessions dispose immediately. Complete single-call input keeps the native fast
path. Provider SDK parsers are unaffected. Small deltas can be slower, so measure
representative arguments before opting in.

The assistant-ui adapter accepts native assistant-stream events: `part-start`
uses the root path `[]`, while deltas and completion use the part index such as
`[0]`. Every part, including text and reasoning, advances that index. Explicitly
indexed `part-start` events from earlier integrations remain supported.

Adapters consume structural event shapes and do not install or load the
provider SDKs. `pushAll()` returns every update when one event contains
multiple calls; existing `push()` usage remains supported. Lifecycle
completion means the arguments are finalized, not that a tool has executed.
The [OpenAI Responses example](examples/README.md#openai-responses) runs a tool
request and previews immutable arguments from the SDK's decoded stream.
The [Mistral Responses example](examples/README.md#mistral-responses) reuses
`streamfold/openai` after unwrapping SDK frames and converting their `itemId`
field to `item_id`.
The Vercel AI SDK adapter uses the final `tool-call` input from `fullStream` or
`tool-input-available` input from `toUIMessageStream()`, preserving schema defaults
and transforms after streamed deltas. It also accepts these events without
preceding deltas and emits their completed input once.

For hosts exposing a tool-input parser factory, embed Streamfold directly:

```ts
import { createToolInputParser } from "streamfold/vercel-ai";

const messages = readUIMessageStream({
  stream,
  experimental_createToolInputParser: createToolInputParser,
});
```

The generic Vercel hook is proposed in [vercel/ai#24197](https://github.com/vercel/ai/pull/24197).
[Harness#527](https://github.com/assistant-ui/harness-sdk/pull/527) accepts the same
factory through `initialToolInputParser`. These host APIs are not yet published.
Each call gets an isolated parser with immutable snapshots. Supply a closure
such as `() => createToolInputParser({ maxBytes: 1024 })` to configure limits.
The host owns completion, cancellation, and authoritative final input. See the
[embedded parser contract](API.md#embedded-tool-input-parser) for lifecycle and
partial-value behavior.

Pass `{ onDiagnostic(diagnostic) { /* report diagnostic */ } }` as an adapter's
second argument for opt-in event-matching and error diagnostics. Parser errors
preserve their native `SyntaxError` or `RangeError` type and include a stable
`code`, a UTF-8 `byteOffset`, and call/event context where available.

LangChain chunks can identify a call by index or, when the index is absent,
by call ID. Each unindexed fragment must carry its call ID. As with
LangChain's `concat`, a new call ID at an index already in use starts a
separate call; the previous call at that index completes first.

For a custom event protocol, `defineAdapter(mapEvent)` accepts a synchronous
mapper returning `start`, `delta`, `end`, or `abort` operations. Each factory
call creates its own parser pool; `pushAll(event)` returns all updates from an
event, including multi-call batches. See [custom adapters](API.md#custom-adapters)
for a switch-based example and lifecycle rules.

Use `readStructured(events, { adapter })` to consume that custom adapter with a
`for await` loop. It yields every update, finalizes remaining calls when the
source ends, and disposes the session when the loop exits. See
[managed consumption](API.md#managed-consumption) for examples and cancellation
boundaries.

For any built-in SDK integration, use
`readStructured(events, { integration: assistantUI })` instead. Both paths yield
the same lifecycle updates and clean up on early exit, without duplicate final
results. See the API reference for factory options.

## Performance

Published `streamfold@0.1.19` parses a 48.5 KB, 3,032-delta fixture in a
4.69 ms median with live values and 6.32 ms with immutable snapshots on an
Apple M1. The same run measures 1,135 ms for assistant-stream's accumulated-prefix
parser and 840 ms for Vercel's. These are parser measurements, not response times.

Tiny one-chunk inputs favor the existing parsers, and fresh-process startup is
slower than 0.1.1. See the [benchmark report](benchmarks/SDK_ADAPTER_REPORT.md)
for median/p95 values, independent A/A controls, startup cost, production-demo
rendering scope, and reproduction commands.

## Documentation

- [Runnable integration examples](examples/README.md)
- [API reference](API.md)
- [Integration and migration guide](MIGRATION.md)
- [Tested integration compatibility](INTEGRATIONS.md)
- [Architecture](ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

## Development

Requires Node.js 22+, pnpm 11, and Rustup.

```bash
pnpm install
pnpm check
pnpm pack:check
```

Benchmarks and the local dashboard are available through `pnpm bench`,
`pnpm bench:sdk`, and `pnpm dashboard`.

Streamfold is pre-1.0 and has not received a security audit. Treat parsed
values as untrusted input and validate them before tool execution.

MIT © Streamfold contributors
