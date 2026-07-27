# Streamfold

> Incremental structured state for AI streams.

[![CI](https://github.com/assistant-ui/streamfold/actions/workflows/ci.yml/badge.svg)](https://github.com/assistant-ui/streamfold/actions/workflows/ci.yml)

Streamfold turns fragmented tool-call JSON into live partial values without
reparsing the complete prefix after every delta. The parser and incremental
value builder run in Rust through an embedded WebAssembly module; the TypeScript
API stays protocol-neutral and works in browser and server runtimes.

```bash
pnpm add streamfold
```

## Performance

One 53,656-byte tool call was delivered as 3,354 16-character deltas. Each
measurement is the median of warmed runs on an Apple M1 using Node.js 23.11.0.

| Use case | **BEFORE — rebuild every delta** | **AFTER — retain state with Streamfold** | **FASTER** |
| --- | ---: | ---: | ---: |
| Vercel UIMessage tool input | `parsePartialJson` — **1,272.33 ms** | Rust/Wasm adapter — **7.45 ms** | **170.7×** |
| Protocol-neutral JSON input | Repair + `JSON.parse` — **1,109.87 ms** | Rust/Wasm core — **7.39 ms** | **150.1×** |

The before column reparses the complete accumulated JSON after every incoming
delta. The after column keeps parser and partial-value state between deltas, so
it processes only the new input.

Streamfold targets frequent, small tool-call deltas. With very large chunks,
the baseline reparses too few times for the same advantage and Wasm boundary
cost can dominate.

This benchmark includes event dispatch, UTF-8 encoding, JavaScript/Wasm calls,
patch application, a live partial value after every delta, and final
`JSON.parse`. It excludes model, network, SSE decoding, schema validation, and
UI rendering. Prefix-by-prefix conformance is tested against Vercel AI SDK for
the repository fixtures; exhaustive drop-in parity is not yet claimed.

Run the measurements on your machine:

```bash
pnpm bench
pnpm bench:sdk
```

Machine-readable results are written to `artifacts/`.

## Core API

```ts
import { createStructuredStream } from "streamfold";

const stream = createStructuredStream();

const first = stream.push('{"city":"San');
first.partialValue;
// { city: "San" }

first.changes;
// [
//   { op: "set", path: [], value: {} },
//   { op: "set", path: ["city"], value: "" },
//   { op: "append", path: ["city"], value: "San" },
// ]

const complete = stream.push(' Francisco"}');
complete.partialValue;
// { city: "San Francisco" }

stream.getFieldState(["city"]);
// "complete"
```

`partialValue` is a live view updated in place for minimum overhead. Reactive
stores can consume the compact `set`, `append`, and `complete` changes instead
of cloning the complete object after every fragment.

For concurrent tool calls, use one pool:

```ts
import { createStructuredStreamPool } from "streamfold";

const streams = createStructuredStreamPool();

streams.start("call-1");
streams.push("call-1", '{"query":"stream');
const update = streams.push("call-1", 'fold"}');
const result = streams.finish("call-1");

console.log(update.partialValue); // { query: "streamfold" }
console.log(result.value); // final JSON value
```

## Integrations

Import only the event shape you need:

```ts
import { createStructuredStream } from "streamfold/assistant-ui";

const toolCalls = createStructuredStream();

for await (const event of assistantStream) {
  const update = toolCalls.push(event);
  if (update) renderToolInput(update.id, update.partialValue);
}
```

Or compose the same integration with the core factory:

```ts
import { createStructuredStream } from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";

const toolCalls = createStructuredStream(assistantUI);
```

Available isolated entry points:

| Import | Event surface |
| --- | --- |
| `streamfold/assistant-ui` | assistant-stream |
| `streamfold/vercel-ai` | Vercel AI SDK `fullStream` and UIMessage |
| `streamfold/openai` | OpenAI Responses |
| `streamfold/anthropic` | Anthropic Messages |
| `streamfold/gemini` | Gemini Interactions |
| `streamfold/langchain` | LangChain message chunks |
| `streamfold/ag-ui` | AG-UI events |

Streamfold has no provider SDK runtime dependencies. Importing one integration
does not load any of the others.

## How it works

```text
SDK event
  → thin event adapter
  → Rust/Wasm incremental JSON engine
  → compact path patches
  → live partial JavaScript value
  → final standards-compliant JSON.parse
```

The performance gain comes primarily from doing one pass over new input instead
of repeatedly processing the entire accumulated prefix. Rust handles parsing
and patch generation; JavaScript applies small mutations to the live value.
WebAssembly keeps the same engine portable across browsers and server runtimes.

## Status

Streamfold is an early, benchmark-backed project. The current conformance suite
covers nested objects and arrays, partial strings and numbers, escapes, Unicode
and surrogate pairs, literals, malformed JSON, prototype-pollution keys,
interleaved tool calls, every partial-object field-state fixture from
`assistant-stream` 0.3.25, and all integration event shapes listed above.

The next milestones are broader provider conformance fixtures, browser
compatibility coverage, and profiling larger real-world traces.

## Development

Requires Node.js 22+, pnpm 11, and Rustup.

```bash
pnpm install
pnpm check
pnpm pack:check
pnpm bench
pnpm bench:sdk
pnpm dashboard
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the Rust/Wasm boundary and
[CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines. Streamfold is
MIT licensed.
