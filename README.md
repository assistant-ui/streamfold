# Streamfold

> Incremental structured state for AI streams.

[![npm](https://img.shields.io/npm/v/streamfold)](https://www.npmjs.com/package/streamfold)
[![CI](https://github.com/assistant-ui/streamfold/actions/workflows/ci.yml/badge.svg)](https://github.com/assistant-ui/streamfold/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Streamfold turns fragmented tool-call JSON into live partial values. Its
Rust/WebAssembly engine keeps parser state between deltas, avoiding a full
reparse after every chunk. The ESM API works in Node.js 20+ and modern browsers
without native build tools or provider SDK dependencies.

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
| `streamfold/openai` | OpenAI Responses |
| `streamfold/anthropic` | Anthropic Messages |
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

Adapters consume structural event shapes and do not install or load the
provider SDKs. `pushAll()` returns every update when one event contains
multiple calls; existing `push()` usage remains supported. Lifecycle
completion means the arguments are finalized, not that a tool has executed.

Pass `{ onDiagnostic(diagnostic) { /* report diagnostic */ } }` as an adapter's
second argument for opt-in event-matching and error diagnostics. Parser errors
preserve their native `SyntaxError` or `RangeError` type and include a stable
`code`, a UTF-8 `byteOffset`, and call/event context where available.

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

On the published `streamfold@0.1.1` benchmark, retaining state was 144–217×
faster than rebuilding the partial value after every 16-character delta for a
48–54 KB tool call. The advantage is largest for frequent, small deltas; plain
`JSON.parse` can be simpler and faster for one-shot JSON or large chunks.

See the [benchmark report](benchmarks/SDK_ADAPTER_REPORT.md) for fixtures,
methodology, raw commands, and crossover points.
These results use default live values; immutable snapshots add copying and
freezing costs, especially for wide, growing arrays or objects.

## Documentation

- [Runnable integration examples](examples/README.md)
- [API reference](API.md)
- [Integration and migration guide](MIGRATION.md)
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
