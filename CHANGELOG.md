# Changelog

## Unreleased

- Avoid temporary path-prefix arrays when applying immutable snapshot patches.
- Isolate rejected diagnostic callback promises without delaying parsing or
  cleanup, preserving the original stream failure.
- Reduce promise allocations in managed readers without an abort signal while
  preserving iterator cleanup and signalled cancellation.
- Avoid temporary per-field completion maps when a patch batch completes the
  document, while preserving partial field states and public patches.
- Skip immutable snapshot allocations for empty patch batches while preserving
  value identity and parser state.
- Reduce allocations when decoding long property names with bounded UTF-16
  batches while preserving escaped lone surrogates.
- Update existing properties directly on owned immutable snapshot copies,
  reducing repeated writes while preserving frozen history and safe key handling.
- Skip parser work for empty deltas while preserving pending tokens, buffered
  Unicode, completion state, and lifecycle errors.

## 0.1.18

- Export `createToolInputParser` from `streamfold/vercel-ai` for generic Vercel AI
  SDK and Harness parser hooks, with immutable values, limits, and safe key handling.
- Avoid copying numeric prefixes solely to compare them and decode large numeric
  patches natively while preserving JavaScript number rounding, partial values,
  and malformed-input rejection.
- Avoid retaining empty chunks in active parser pools while preserving their
  updates, byte limits, and final text.
- Surface decoded Anthropic stream errors and discard pending tool arguments,
  preserving the provider failure instead of completing calls at EOF.

## 0.1.17

- Add explicit `initializeAssistantStream()` to `streamfold/assistant-ui` for
  hosts exposing generic JSON parser registration, preserving the existing event
  adapter and native fallback when the host or WASM support is unavailable.
- Allocate completion child maps only for nodes with descendants and release
  them when a field completes, reducing memory retained by open streams.
- Decode large string append patches with the platform UTF-16 decoder, avoiding
  temporary code-unit arrays while preserving BOM characters, escaped lone
  surrogates, and runtimes without UTF-16 decoding support.
- Reject assistant-ui error finish reasons before pending tool arguments can
  complete at EOF, preserving the failed step or message event.
- Reject Vercel AI error finish reasons and defer pending arguments at UI step
  boundaries until the final stream status is available or the source ends.
- Reject failed Gemini interaction status updates before EOF can complete
  pending arguments, preserving provider status details.
- Complete LangChain calls with empty arguments as `{}`, preserving validation
  and parser limits for indexed and unindexed calls.
- Preserve Anthropic empty tool inputs when no argument text arrives, while
  continuing to reject incomplete or malformed streamed arguments.
- Reject Cohere error and timeout endings even without error text, discarding
  pending arguments and preserving the provider's failure details.
- Surface native assistant-ui stream errors and discard pending arguments,
  preserving the error event and its metadata.
- Reject malformed Bedrock generation endings and discard pending arguments,
  preserving the stop reason and provider details.
- Surface Gemini streaming error events and discard pending arguments instead
  of completing them at EOF, preserving provider error details.
- Reject Vercel AI abort events before finalizing pending arguments, preserving
  the cancellation reason even without a shared reader signal.

## 0.1.16

- Surface AG-UI run errors and release pending parsers instead of finalizing
  arguments from a failed run.
- Surface Vercel AI provider and tool-input errors instead of completing pending
  arguments normally, preserving upstream errors and releasing active parsers.
- Route native assistant-stream tool arguments by their part indexes, including
  calls after non-tool parts and merged streams, while retaining explicit paths.
- Release input buffers and unused patch capacity after scanner finalization,
  reducing Wasm allocation when completed scanners remain referenced.
- Use OpenAI final arguments when deltas are missing or incomplete and suppress
  repeated completion events while preserving explicit call ID reuse.
- Surface OpenAI failed and terminal incomplete responses, preserving failure
  details and aborting pending calls while leaving steering handoffs non-fatal.
- Reject unsuccessful Gemini terminal statuses before finalizing pending
  arguments, while preserving successful tool handoffs and legacy events.

## 0.1.15

- Add a Mistral Responses example that normalizes SDK frames and reuses the
  OpenAI adapter, with SDK decoding and cancellation coverage.
- Add a Cohere v2 adapter for SDK and decoded wire tool argument streams.
- Add a Bedrock ConverseStream adapter for streaming tool-use arguments.
- Accept Anthropic stable and beta SDK message event interfaces directly in
  the Anthropic adapter and managed reader.
- Accept OpenAI SDK response stream event types directly in the OpenAI adapter
  and managed reader, including non-tool events.
- Preserve Gemini Interactions tool arguments from `arguments_delta` events
  without treating the initial empty object as the completed input.
- Reuse the final frozen snapshot in immutable pool completions, avoiding a
  second JSON value tree while keeping live final values independently parsed.
- Release consumed completion payloads in managed SDK readers while preserving
  manual completion history and duplicate suppression.
- Preserve Vercel AI SDK schema defaults and transforms in completed tool inputs,
  including `fullStream` calls without argument deltas, with replacement patches
  when the final input differs from streamed arguments.
- Keep LangChain tool calls without indexes separate by their IDs and accept
  SDK message chunk types directly.
- Release descendant completion metadata when a JSON container completes,
  reducing retained memory while preserving field-state queries.

## 0.1.14

- Reuse string append buffers and borrow their paths between streamed chunks,
  avoiding repeated delta allocations and path copies.
- Decode streamed UTF-8 directly into the existing key and value buffers,
  avoiding temporary UTF-16 allocations.
- Avoid redundant parent-link writes within immutable snapshot batches while
  preserving frozen historical values and structural sharing.

## 0.1.13

- Report the accepted UTF-8 byte offset when a chunk exceeds the byte limit
  before entering the WASM parser.
- Preserve Vercel AI SDK tool inputs that arrive complete without argument deltas.
- Scan numeric prefixes once instead of repeatedly parsing them, avoiding
  quadratic work on malformed numeric chunks.
- Mark a replaced field partial as soon as a new negative number starts,
  preserving the previous partial value until the first digit arrives.

## 0.1.12

- Refresh development and assistant-ui demo dependencies, including security
  patches, and group React and React DOM updates to keep their versions aligned.
- Update CI and release setup tooling.

The published parser source and public API are unchanged from 0.1.11.

## 0.1.11

- Copy frozen arrays by iteration when producing immutable snapshots, reducing
  the cost of streaming dense arrays while retaining historical values.
- Process unescaped string runs in batches, reducing Rust token-state handling
  while preserving partial values, escapes, and invalid-input offsets.

## 0.1.10

- Reject form feeds outside JSON strings, keeping incremental acceptance consistent
  with JSON.parse across chunk boundaries.

## 0.1.9

- Keep one embedded WebAssembly payload in minified browser bundles when both
  synchronous startup and asynchronous preparation are used, reducing download
  size without changing parser behavior or public APIs.

## 0.1.8

- Enforce byte limits before allocating WebAssembly input memory, preventing
  oversized chunks from unnecessarily growing the parser's linear memory.
- Add `prepareStreamfold()` to compile and cache the WebAssembly module before
  first use.

## 0.1.7

- Close failing upstream iterators and support reader-only `ReadableStream`
  sources in `readStructured` whether or not an abort signal is supplied.
- Accept browser readable streams in the public types without requiring
  `DOM.AsyncIterable` in the consumer's TypeScript libraries.
- Reject raw unpaired UTF-16 surrogates with `INVALID_CHUNK` instead of silently
  producing different partial and final values. Split valid pairs and JSON
  Unicode escapes remain supported.
- Add the standalone assistant-ui weather, complex tools, and parser comparison
  demo, including visible timing, idle preparation, and repeatable benchmarks.
- Preserve the demo's selected scenario and speed when resetting a conversation,
  and check its production build and browser flows in CI.

## 0.1.6

- Add runnable, SDK-typechecked assistant-ui, Vercel AI, and custom-protocol
  examples, including cancellation and custom-adapter contract tests.
- Add Node-only `streamfold/testing` contract cases for custom adapter authors,
  compatible with Node-based test runners and batched or split event protocols.
- Add optional `AbortSignal` support to managed consumption, with immediate
  parser cleanup, stalled-read cancellation, and explicit upstream boundaries.

## 0.1.5

- Add `defineAdapter(mapEvent)` for custom streaming protocols, with ordered
  operations and a fresh parser pool for each adapter instance.
- Add `readStructured(source, options)` for managed consumption of iterable
  and readable streams, including backpressure and automatic cleanup.
- Add `pushAll(event)` to every built-in adapter, returning all ordered
  `start`, `update`, and `complete` lifecycle updates without changing `push()`.
- Use the same lifecycle tags for custom adapters and managed consumption.
  Add managed SDK integration support with cleanup and no duplicate completions.
- Add opt-in `snapshots: "immutable"` for deeply frozen partial and final
  values with structural sharing; default live mode remains unchanged.
- Add structured error codes, UTF-8 offsets, call/event context, and the
  `isStructuredStreamError` guard while preserving native error categories.
- Add opt-in SDK/custom adapter diagnostics and forward them through managed
  consumption; mapper failures remain terminal and release active parsers.

## 0.1.4

- Add a practical migration guide for adopting Streamfold with existing SDKs.
- Clarify installation, API usage, contribution guidelines, and benchmark context.
- Refresh development dependencies and the pinned Rust/Wasm build toolchain.
- Remove a duplicate development dependency and ignore local environment files,
  logs, and package archives.
- Mark beta GitHub releases as prereleases to match the npm beta channel.

The JavaScript API is unchanged from the v0.1.3 source tag. That version was
not published to npm; the previous npm release is 0.1.2.
