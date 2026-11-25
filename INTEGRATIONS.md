# Integration compatibility

Streamfold parses incremental JSON tool arguments. An event adapter reads
already decoded SDK events; it does not replace the provider SDK's own parser,
validate a tool schema, or execute tools. A host parser hook is a separate
integration point.

This matrix records the pinned SDK versions and local evidence checked on
2026-11-18, with Mistral chat, the Agents Runner, and OpenRouter checked on 2026-11-25. No live model
request was made for this review. Fixture compatibility does not guarantee
support for every model or future SDK version.

## Event adapters

Nine adapter subpaths shipped by Streamfold 0.1.19. The additional Chat
Completions export requires 0.1.20 or newer. The four new entries (Pi, OpenAI Agents, OpenRouter, and Mistral chat)
are unreleased and absent from 0.1.21. SDKs remain application dependencies.

| Event source | Import | SDK tested | Evidence |
| --- | --- | --- | --- |
| assistant-stream chunks | `streamfold/assistant-ui` | `assistant-stream` 0.3.54 | Partial-value and field-state conformance; event/lifecycle fixtures; production demo |
| Vercel AI SDK `fullStream` and UI messages | `streamfold/vercel-ai` | `ai` 7.0.166 | Real `streamText`/UI conversion with a mocked model; transformed final inputs, no-argument tools, and failure tests |
| Mistral `chat.stream` | `streamfold/mistral` (`mistralChat`, unreleased) | `@mistralai/mistralai` 3.4.0 | Real SSE decoder, interleaved IDs, whole argument objects, truncation, stalled reader cancellation |
| OpenAI Responses | `streamfold/openai` (`openAI`) | `openai` 7.47.0 | Real SDK SSE decoder with synthetic responses, failures, and incomplete endings |
| OpenAI Chat Completions | `streamfold/openai` (`openAIChatCompletions`, since 0.1.20) | `openai` 7.47.0 | 21 focused protocol/SDK tests, 8 packed-package SDK tests, Chrome smoke |
| OpenAI Agents Runner (unreleased) | `streamfold/openai-agents` (`openAIAgents`) | `@openai/agents` 0.22.0, `openai` 7.47.0 | Offline Runner and HTTP SSE decoders, handoff across turns, failure, cancellation and final output |
| OpenRouter chat | `streamfold/openrouter` (`openRouter`, unreleased) | `@openrouter/sdk` 1.5.137 (pinned), 1.5.141 (separate fixture run) | Native `chat.send` SSE decoder, interleaved calls, error chunks, length truncation, pending-read cancellation |
| Anthropic Messages and beta Messages | `streamfold/anthropic` | `@anthropic-ai/sdk` 1.9.0 | Real SDK stream decoding, initial inputs, JSON deltas, server tools, and beta MCP tool inputs |
| Cohere v2 Chat | `streamfold/cohere` | `cohere-ai` 8.3.1 | Real SDK SSE decoder, camelCase conversion, interleaved calls, no-argument calls, terminal failures |
| Amazon Bedrock ConverseStream | `streamfold/bedrock` | `@aws-sdk/client-bedrock-runtime` 3.1161.0 | Real SDK event-stream serialization/deserialization through an injected request handler, including tool blocks without input deltas |
| Gemini Interactions | `streamfold/gemini` | `@google/genai` 3.5.0 | Real SDK Interactions SSE decoder, streamed arguments and terminal outcomes |
| LangChain message chunks | `streamfold/langchain` | `@langchain/core` 1.4.1 | Real `AIMessageChunk`/`convertToChunk` objects, indexed and unindexed arguments |
| Pi native `AssistantMessageEvent` | `streamfold/pi` (unreleased) | `@earendil-works/pi-ai` 1.6.0 (pinned) | Offline OpenAI Chat and Anthropic Messages decoders, SDK types, split and complete inputs, cancellation |
| AG-UI tool argument events | `streamfold/ag-ui` | `@ag-ui/client` and `@ag-ui/core` 1.0.5 | Real client SSE decoding, compact chunk normalization, interleaved and no-argument calls, terminal errors, local HTTP cancellation, and SDK types |

The Pi fixtures run against the pinned development SDK. A separate local run
on 2026-11-25 also checked the native types and both decoders with Pi AI 1.6.1.

Mistral Responses also works through the maintained
[`examples/mistral.mjs`](examples/mistral.mjs) normalization layer, tested with
`@mistralai/mistralai` 3.4.0's real decoder. It unwraps `frame.data` and converts
`itemId` to the existing OpenAI adapter's `item_id`. It also normalizes
incomplete-response details so the existing adapter
rejects failed, incomplete, and error events with their failure details intact.
The example discards pending inputs on failure; completed tool arguments do not
establish success of the entire response. Aborting a pending read releases the
SDK stream lock and cancels the response body.

Gemini's adapter targets **Interactions**, not native GenerateContent object
arguments. The Ollama example below targets its OpenAI-compatible endpoint,
not native `/api/chat` object arguments. Completed argument objects do not need
incremental string parsing.

## AG-UI client boundary

The AG-UI checks added on 2026-11-19 use the real `HttpAgent` client with
synthetic responses and a local HTTP server. The client expands `TOOL_CALL_CHUNK`
into `TOOL_CALL_START`, `TOOL_CALL_ARGS`, and `TOOL_CALL_END` before invoking
subscribers. Feed those normalized events to `agUI`; raw compact chunks are not
part of Streamfold's adapter contract.

`HttpAgent` logs subscriber exceptions instead of rejecting `runAgent()` for
them. Capture Streamfold errors inside `onEvent`, abort the request, and rethrow
after the run. Dispose pending pool entries on every exit, including caller
cancellation. For example (also type-checked in `tests/ag-ui-sdk.ts`):

```ts
const pool = createStructuredStreamPool({ snapshots: "immutable" });
const stream = agUI(pool);
const errors: unknown[] = [];
try {
  await agent.runAgent({}, {
    onEvent({ event, agent }) {
      if (errors.length) return;
      try {
        for (const update of stream.pushAll(event)) consume(update);
      } catch (error) {
        errors.push(error);
        agent.abortRun();
      }
    },
  });
  if (errors.length) throw errors[0];
} finally {
  for (const id of pool.activeIds) pool.abort(id);
}
```

Here `agent` is your `HttpAgent` and `consume` handles previews and completed
inputs; act only on `complete` updates. Pending calls are discarded on exit.
Import `createStructuredStreamPool` from `streamfold` and `agUI` from
`streamfold/ag-ui`. These checks do not contact a live AG-UI backend.

## Examples and version requirements

The following changes are merged. Chat Completions and the compatible-provider
examples require Streamfold 0.1.20 or newer; they are absent from 0.1.19.

| Example | Evidence | Version boundary |
| --- | --- | --- |
| [Chat Completions](examples/openai-chat-completions.mjs) | Real OpenAI 7.47.0 SDK decoder, interleaved tools, immutable previews, cancellation and failures | Uses `openAIChatCompletions` from `streamfold/openai`, since 0.1.20 |
| [Ollama/Groq](examples/openai-compatible.mjs) | 11 fixture/CLI tests also pass against a packed candidate using OpenAI 7.47.0; no live providers | Requires 0.1.20; one shared parser and explicit endpoint configuration |
| [OpenAI Responses](examples/openai.mjs) | 9 example tests, including real SDK/local HTTP and cancellation | Uses the existing Responses adapter |
| [Assistant-ui demo](examples/assistant-ui-demo) | 24 unit tests, production build, 7 browser tests | Published-release pin is recorded in its manifest and lockfile |

The opt-in [manual provider smoke command](examples/README.md#manual-provider-smoke-checks)
checks OpenAI, Anthropic, Groq, and Ollama one at a time. It prints a plan until
`--apply` is supplied. Its SDK/local HTTP tests are offline evidence; no live
provider result is claimed here.

## Host parser hooks and upstream work

| Host | What ships in Streamfold | Upstream status and limit |
| --- | --- | --- |
| assistant-stream / assistant-ui | `initializeAssistantStream()` optionally registers a parser backend; `disableAssistantStream()` removes its registration or cancels pending setup; the event adapter is independent | [assistant-ui #10700](https://github.com/assistant-ui/assistant-ui/pull/10700) documents setup. Earlier release verification exercised npm `assistant-stream` 0.3.57 with Streamfold 0.1.19. The initializer returns `false` when the host registration API is unavailable; check its result. The demo's comparison uses event adapters, not this replacement hook. |
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
node --test benchmarks/*conformance.test.mjs benchmarks/sdk-cases.test.mjs benchmarks/ag-ui-sdk.test.mjs examples/mistral*.test.mjs
pnpm check
pnpm pack:check
```

All 32 published 0.1.19 runtime/declaration files were also compared byte-for-byte
with the source used by these repository checks; they match.

The repository's SDK fixture tests cover protocol conversion and parser
lifecycle. They do not measure network/model latency or guarantee end-to-end
application speedups. See the [published performance report](benchmarks/SDK_ADAPTER_REPORT.md)
for exact payloads, snapshot modes, noise controls, and rendering scope.
