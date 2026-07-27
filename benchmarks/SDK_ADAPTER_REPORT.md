# SDK adapter benchmark

This benchmark measures whether one protocol-neutral incremental value engine
can consume major AI SDK tool-input event shapes without losing its performance
advantage.

## Result

The fixture suite passes for assistant-stream, both Vercel AI SDK stream
surfaces, OpenAI Responses, Anthropic Messages, AG-UI, Gemini Interactions, and
LangChain. It interleaves four calls, fragments each input every seven
characters, and verifies IDs, partial updates, text, and final values.

For one 53,656-byte tool call delivered as 3,354 16-character deltas:

| Path | Median |
| --- | ---: |
| Vercel AI SDK 7.0.22 `parsePartialJson` every delta | 1,252.85 ms |
| Repair and `JSON.parse` every delta | 1,098.34 ms |
| Direct Streamfold Rust/Wasm core | 6.33 ms |
| Vercel AI SDK `fullStream` events through Streamfold | 6.36 ms |
| Vercel AI SDK UIMessage events through Streamfold | 6.35 ms |
| Slowest measured Streamfold integration | 6.74 ms |

The direct Streamfold path was 198.0× faster than the measured Vercel partial
parser and 173.6× faster than repair-and-reparse for this workload.

Unlike the earlier structural-only experiment, Streamfold now returns a live
partial JavaScript value and compact changes after each delta. The repository
checks its partial result against Vercel AI SDK at every character boundary for
the conformance fixtures. This is a substantially closer comparison, but the
fixture set is not an exhaustive drop-in compatibility claim.

## What is measured

- prebuilt SDK-shaped event dispatch and tool-call identity lookup;
- UTF-8 encoding and every JavaScript/Wasm boundary crossing;
- incremental Rust parsing and patch generation;
- applying patches to the live JavaScript partial value;
- final string join and `JSON.parse`.

## What is not measured

- model, network, or SSE latency;
- framework rendering;
- schema validation;
- cold Wasm compilation before warmups;
- every malformed or provider-specific payload.

Run `pnpm test` for conformance and `pnpm bench:sdk` for measurements. Raw
results, including warmed median, p95, environment, and concurrent-call
scenarios, are written to `artifacts/sdk-adapter-results.json`.
