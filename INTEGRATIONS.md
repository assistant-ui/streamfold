# Integration compatibility

Streamfold parses incremental JSON tool arguments. An event adapter reads
already decoded SDK events; it does not replace the provider SDK's own parser,
validate a tool schema, or execute tools. A host parser hook is a separate
integration point.

This matrix records the pinned SDK versions and local evidence checked on
2026-11-18. No live model request was made for this review. Fixture compatibility
does not guarantee support for every model or future SDK version.

## Event adapters

All nine subpaths below are available in Streamfold 0.1.19. The additional Chat
Completions export requires 0.1.20 or newer. SDKs remain application dependencies.

| Event source | Import | SDK tested | Evidence |
| --- | --- | --- | --- |
| assistant-stream chunks | `streamfold/assistant-ui` | `assistant-stream` 0.3.54 | Partial-value and field-state conformance; event/lifecycle fixtures; production demo |
| Vercel AI SDK `fullStream` and UI messages | `streamfold/vercel-ai` | `ai` 7.0.166 | Real `streamText`/UI conversion with a mocked model; transformed final inputs and failure tests |
| OpenAI Responses | `streamfold/openai` (`openAI`) | `openai` 7.47.0 | Real SDK SSE decoder with synthetic responses, failures, and incomplete endings |
| OpenAI Chat Completions | `streamfold/openai` (`openAIChatCompletions`, since 0.1.20) | `openai` 7.47.0 | 21 focused protocol/SDK tests, 8 packed-package SDK tests, Chrome smoke |
| Anthropic Messages and beta Messages | `streamfold/anthropic` | `@anthropic-ai/sdk` 1.4.0 | Real SDK stream decoding, initial inputs, JSON deltas, server tools, and beta MCP tool inputs |
| Cohere v2 Chat | `streamfold/cohere` | `cohere-ai` 8.3.0 | Real SDK SSE decoder, camelCase conversion, interleaved calls, terminal failures |
| Amazon Bedrock ConverseStream | `streamfold/bedrock` | `@aws-sdk/client-bedrock-runtime` 3.1161.0 | Real SDK event-stream serialization/deserialization through an injected request handler |
| Gemini Interactions | `streamfold/gemini` | `@google/genai` 2.31.0 | Real SDK Interactions SSE decoder, streamed arguments and terminal outcomes |
| LangChain message chunks | `streamfold/langchain` | `@langchain/core` 1.3.0 | Real `AIMessageChunk`/`convertToChunk` objects, indexed and unindexed arguments |
| AG-UI tool argument events | `streamfold/ag-ui` | No AG-UI SDK dependency | Structural event fixtures and shared lifecycle tests only |

Mistral Responses also works through the maintained
[`examples/mistral.mjs`](examples/mistral.mjs) normalization layer, tested with
`@mistralai/mistralai` 3.4.0's real decoder. It unwraps `frame.data` and converts
`itemId` to the OpenAI adapter's `item_id`; it is an example, not a tenth provider
subpath. It also normalizes incomplete-response details so the existing adapter
rejects failed, incomplete, and error events with their failure details intact.
The example discards pending inputs on failure; completed tool arguments do not
establish success of the entire response.

Gemini's adapter targets **Interactions**, not native GenerateContent object
arguments. The Ollama example below targets its OpenAI-compatible endpoint,
not native `/api/chat` object arguments. Completed argument objects do not need
incremental string parsing.

## Examples and version requirements

The following changes are merged. Chat Completions and the compatible-provider
examples require Streamfold 0.1.20 or newer; they are absent from 0.1.19.

| Example | Evidence | Version boundary |
| --- | --- | --- |
| [Chat Completions](examples/openai-chat-completions.mjs) | Real OpenAI 7.47.0 SDK decoder, interleaved tools, immutable previews, cancellation and failures | Uses `openAIChatCompletions` from `streamfold/openai`, since 0.1.20 |
| [Ollama/Groq](examples/openai-compatible.mjs) | 11 fixture/CLI tests also pass against a packed candidate using OpenAI 7.47.0; no live providers | Requires 0.1.20; one shared parser and explicit endpoint configuration |
| [OpenAI Responses](examples/openai.mjs) | 9 example tests, including real SDK/local HTTP and cancellation | Uses the existing Responses adapter |
| [Assistant-ui demo](examples/assistant-ui-demo) | 24 unit tests, production build, 7 browser tests | Published-release pin is recorded in its manifest and lockfile |

## Host parser hooks and upstream work

| Host | What ships in Streamfold | Upstream status and limit |
| --- | --- | --- |
| assistant-stream / assistant-ui | `initializeAssistantStream()` optionally registers a parser backend; the event adapter is independent | [assistant-ui #10700](https://github.com/assistant-ui/assistant-ui/pull/10700) documents setup. Earlier release verification exercised npm `assistant-stream` 0.3.57 with Streamfold 0.1.19. The initializer returns `false` when the host registration API is unavailable; check its result. The demo's comparison uses event adapters, not this replacement hook. |
| Vercel AI SDK | `createToolInputParser` from `streamfold/vercel-ai` | [Vercel #24197](https://github.com/vercel/ai/pull/24197) proposes the host hook. A Streamfold adapter export does not mean the upstream hook is released. |
| Harness AI SDK, LangGraph, and Mastra transports | The same `createToolInputParser` factory | [Harness #527](https://github.com/assistant-ui/harness-sdk/pull/527) remains a draft for API review. It currently needs a version-scoped `ai@7.0.149` patch. Local tests: 510 passed, one cloud timeout also reproduced on main. |
| Anthropic SDK | Released event adapter | [Anthropic #1291](https://github.com/anthropics/anthropic-sdk-typescript/pull/1291) is an integration example; it does not replace the SDK's default parser. |

Upstream PR status is a dated snapshot. Follow each PR for its current outcome;
do not infer release availability from a passing local test or an open proposal.

## Verification and limits

Run the checked-in SDK fixtures and type boundaries without credentials:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
node --test benchmarks/*conformance.test.mjs benchmarks/sdk-cases.test.mjs examples/mistral.test.mjs
pnpm check
pnpm pack:check
```

All 32 published 0.1.19 runtime/declaration files were also compared byte-for-byte
with the source used by these repository checks; they match.

The repository's SDK fixture tests cover protocol conversion and parser
lifecycle. They do not measure network/model latency or guarantee end-to-end
application speedups. See the [published performance report](benchmarks/SDK_ADAPTER_REPORT.md)
for exact payloads, snapshot modes, noise controls, and rendering scope.
