# Published package benchmark

This report measures the npm-published `streamfold@0.1.1` artifact, not a
repository-relative source import. The benchmark runner installs the package
from:

```text
https://registry.npmjs.org/streamfold/-/streamfold-0.1.1.tgz
```

The measured tarball has this registry integrity:

```text
sha512-+bVJfbiuWqXagmjmjw6SPDrDIgBYCHtkKVo1keunqFeYlsSDsxPjNzcNrCVJZW7+4lb9+sHPLzPiSPlo8ftaFw==
```

## Environment

- Apple M1, macOS arm64
- Node.js 23.11.0
- `streamfold` 0.1.1 from npm
- `assistant-stream` 0.3.25
- Vercel AI SDK 7.0.22

Results are warmed medians from one local machine. They are evidence for the
algorithmic difference in these fixtures, not universal latency guarantees.

## Real parser replacement

One 53,656-byte tool call is delivered as 3,354 16-character deltas. Each
baseline reparses the complete accumulated prefix after every delta.

| Existing path | Existing median | Streamfold event path | Streamfold median | Ratio |
| --- | ---: | --- | ---: | ---: |
| `assistant-stream` `parsePartialJsonObject` | 1,876.95 ms | `streamfold/assistant-ui` | 8.62 ms | 217.7× |
| Vercel AI SDK `parsePartialJson` | 1,434.15 ms | `streamfold/vercel-ai` UIMessage | 8.63 ms | 166.1× |
| Generic repair + `JSON.parse` | 1,145.55 ms | Published Rust/Wasm core | 7.91 ms | 144.8× |

The Streamfold measurements include event dispatch, ID lookup, UTF-8 encoding,
JavaScript/Wasm calls, Rust parsing, patch decoding, live partial-value updates,
one final join, and one final `JSON.parse`.

## Integration matrix

All integrations process the same 53,656 bytes and 3,354 deltas.

| Integration | Median | p95 |
| --- | ---: | ---: |
| assistant-stream | 8.62 ms | 11.26 ms |
| Vercel AI SDK `fullStream` | 8.71 ms | 12.83 ms |
| Vercel AI SDK UIMessage | 8.63 ms | 10.74 ms |
| OpenAI Responses | 8.65 ms | 11.17 ms |
| Anthropic Messages | 9.26 ms | 19.63 ms |
| AG-UI | 9.50 ms | 15.06 ms |
| Google Gemini Interactions | 9.01 ms | 12.96 ms |
| LangChain `AIMessageChunk` | 9.02 ms | 11.22 ms |

The sub-millisecond ordering between adapters is benchmark noise, not evidence
that one provider is faster. The useful result is that all event envelopes stay
in the same narrow range.

Eight interleaved tool calls process 106,344 total bytes across 3,328 deltas:

| Integration | Median | p95 |
| --- | ---: | ---: |
| assistant-stream | 19.93 ms | 27.45 ms |
| Vercel AI SDK `fullStream` | 19.03 ms | 27.43 ms |
| Vercel AI SDK UIMessage | 17.41 ms | 23.56 ms |
| OpenAI Responses | 17.06 ms | 21.20 ms |
| Anthropic Messages | 16.41 ms | 20.38 ms |
| AG-UI | 16.23 ms | 20.91 ms |
| Google Gemini Interactions | 14.81 ms | 17.78 ms |
| LangChain `AIMessageChunk` | 15.00 ms | 17.95 ms |

## Crossover by payload and chunk size

This matrix compares generic repair-and-reparse with the published Streamfold
core. A ratio below 1× means repair-and-reparse was faster.

| Payload | Chunk | Repair + parse | Streamfold | Ratio |
| ---: | ---: | ---: | ---: | ---: |
| 953 B | 16 B | 0.893 ms | 0.263 ms | 3.4× |
| 953 B | 256 B | 0.038 ms | 0.118 ms | 0.32× |
| 953 B | 4,096 B | 0.005 ms | 0.112 ms | 0.04× |
| 9,529 B | 16 B | 61.922 ms | 1.534 ms | 40.4× |
| 9,529 B | 256 B | 3.126 ms | 1.125 ms | 2.8× |
| 9,529 B | 4,096 B | 0.240 ms | 1.060 ms | 0.23× |
| 48,449 B | 16 B | 1,145.550 ms | 7.913 ms | 144.8× |
| 48,449 B | 256 B | 68.058 ms | 10.539 ms | 6.5× |
| 48,449 B | 4,096 B | 4.764 ms | 8.016 ms | 0.59× |

Streamfold is aimed at long structured values delivered as many small model
deltas. It is not a replacement for one final `JSON.parse`, and it should not
be added to one-shot or already-large JSON chunks merely because Rust is
available.

## Scope

Measured:

- published npm Rust/Wasm code;
- real assistant-stream and Vercel partial parsers;
- official-shaped events for every listed integration;
- interleaved concurrent calls;
- live partial values and final values.

Not measured:

- model, network, SSE decoding, or provider latency;
- React rendering;
- schema validation;
- cold Wasm compilation before warmups;
- provider SDK request creation;
- every malformed provider payload.

OpenAI, Anthropic, Gemini, LangChain, and AG-UI expose streaming event
envelopes, but do not provide an equivalent public partial-JSON materializer to
benchmark directly. Their rows therefore measure Streamfold integration cost,
not a claim that Streamfold makes those provider SDKs themselves faster.

## Reproduce

```bash
pnpm install
pnpm bench:published 0.1.1
```

The runner installs the requested Streamfold version into a temporary project,
checks the installed version, runs both benchmark suites, and removes the
temporary project. Machine-readable output is written to:

```text
artifacts/published-package.json
artifacts/published-benchmark-results.json
artifacts/published-sdk-adapter-results.json
```
