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

`partialValue` is updated in place. Reactive stores can apply the compact
`set`, `append`, and `complete` patches in `changes` instead of cloning the
whole value.

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
import { createStructuredStream } from "streamfold/assistant-ui";

const toolInputs = createStructuredStream();

for await (const event of assistantStream) {
  const update = toolInputs.push(event);
  if (update) renderToolInput(update.id, update.partialValue);
}
```

Adapters consume structural event shapes and do not install or load the
provider SDKs.

## Performance

On the published `streamfold@0.1.1` benchmark, retaining state was 144–217×
faster than rebuilding the partial value after every 16-character delta for a
48–54 KB tool call. The advantage is largest for frequent, small deltas; plain
`JSON.parse` can be simpler and faster for one-shot JSON or large chunks.

See the [benchmark report](benchmarks/SDK_ADAPTER_REPORT.md) for fixtures,
methodology, raw commands, and crossover points.

## Documentation

- [API reference](API.md)
- [Integration and migration guide](MIGRATION.md)
- [Architecture](ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
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
