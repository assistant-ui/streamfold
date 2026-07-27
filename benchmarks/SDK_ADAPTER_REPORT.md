# SDK adapter benchmark

This benchmark asks two separate questions:

1. Can one protocol-neutral state pool consume the tool-input streams exposed by
   major AI SDKs?
2. Does mapping each SDK event envelope into that pool erase the performance
   opportunity?

## Result

Yes to the first question, and no to the second.

The conformance fixture passes for assistant-stream, both Vercel AI SDK stream
surfaces, OpenAI Responses, Anthropic Messages, AG-UI, Gemini Interactions, and
LangChain. Four tool calls are interleaved and fragmented every seven
characters. Every path reconstructs the same text and final JavaScript value.

For a 53,656-byte tool input delivered in 3,354 deltas, direct Rust/Wasm core
ingestion took about 0.73 ms median. The adapters took about 0.77–0.85 ms.
Total dispatch overhead was therefore about 0.12 ms or less across the complete
stream.

For eight concurrent calls totaling 106,344 bytes and 3,328 interleaved deltas,
direct core took about 1.06 ms. The adapters took about 1.08–1.20 ms, adding
about 0.14 ms or less for the complete workload.

## Vercel AI SDK comparison

The root benchmark installs Vercel AI SDK 7.0.22 as a development-only
dependency and calls its public `parsePartialJson` export after every accumulated
delta. That path took about 1,310 ms for the one-call scenario. Routing the same
Vercel UIMessage-shaped events through Streamfold took about 0.81 ms.

This approximately 1,600× difference must not be presented as a drop-in
application speedup. The outputs available during streaming differ:

- Vercel returns a repaired, renderable partial object after each delta.
- Streamfold currently returns structural state after each delta and parses the
  final object once.

The experiment proves that event normalization is cheap and identifies repeated
prefix parsing as the target. The next engineering milestone is an incremental
value builder that preserves partial-object behavior without revisiting the
complete prefix.

## What is not measured

- model or network latency;
- SSE decoding and framework rendering;
- schema validation;
- cold Wasm compilation before benchmark warmups;
- malformed provider events;
- partial-object materialization parity.

Run `pnpm test` for conformance and `pnpm bench:sdk` for the measurements. Raw
results are written to `artifacts/sdk-adapter-results.json`.
