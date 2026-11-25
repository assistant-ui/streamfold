# Changelog

## Unreleased

- Aborting a pending read in the Mistral Responses example now releases the SDK
  stream lock and cancels the response body with the abort reason.

- Route assistant-ui tool arguments to the correct call when a stream mixes
  explicit part paths and root-path starts. Previously a later call could
  lose its arguments and fail with `EMPTY_INPUT`.

- Keep one large push from growing the shared Wasm memory for the life of the
  process. Patches are now built in batches of about 64 KiB, the input buffer
  is sized from the chunk's UTF-8 length rather than three bytes per
  character, and buffers larger than 64 KiB are returned to the allocator
  after each push. On Node 24, one 4 MB push of a number array grows Wasm
  memory by about 4 MiB instead of 140 MiB, a 16 MiB push by about 16 MiB
  instead of 529 MiB, and a 4 MB string by about 23 MiB instead of 39 MiB. A
  whole-document push still reports one root `set` and `complete` however many
  batches it spans. Wasm memory still never shrinks; see `API.md`. Patches,
  values, and errors are unchanged.
- Accept an explicit `undefined` for optional fields under TypeScript's
  `exactOptionalPropertyTypes`, matching what the runtime already does. This
  covers stream and pool options (`maxBytes`, `maxDepth`, `snapshots`,
  `maxActiveStreams`, `onDiagnostic`), `readStructured`'s `signal` and
  `limits` (plus the unused `adapter` or `integration` key), and optional
  fields on the LangChain, OpenAI Chat Completions, AG-UI, Anthropic, Cohere,
  Gemini, assistant-ui, and Vercel event types. `createStructuredStream(options)`
  now also accepts `StructuredStreamOptions | undefined`, so a wrapper can
  forward its own optional `options`. Runtime behavior is unchanged.
- **Behavior change:** A `push` that opens and closes the root object or array
  now reports `changes` as one `set` of the whole value at `[]` and one
  `complete` at `[]`. Previously it reported a `set` and a `complete` for every
  nested value, each with its own copy of the path, so one 1 MB push nested 127
  levels deep allocated about 1 GB of heap, and a 4 MB push ran Node out of
  memory. The same push now retains about 10 MB. This applies to whole documents
  pushed at once, initial input passed to `start`, and pool `finish(id,
  finalText)` replacements. Values, `partialValue`, and `getFieldState` are
  unchanged. Code that reads `changes` sees fewer patches, `set` values that
  are complete objects or arrays rather than `{}` or `[]`, no `append` for the
  strings inside, and no `complete` for nested paths. Pushes that leave the
  root open are unchanged. The embedded tool-input parser and the
  assistant-stream backend now also reject `__proto__` and
  `constructor.prototype` keys inside such a value.
- **Behavior change:** `maxDepth` now accepts at most `65535`. Larger values
  used to be accepted, but the Rust parser encodes path lengths in 16 bits, so
  with `maxDepth: 1_000_000` a value nested 65,537 levels deep was reported at
  depth 65,535 with no error. Those values now fail with `INVALID_OPTIONS`.
- Report every invalid option in one `INVALID_OPTIONS` error. Scanners, pools,
  adapter sessions, `readStructured` limits, and `createToolInputParser` used to
  stop at the first problem; the message now names each invalid key, its
  allowed values, and the value received. A single invalid limit is still a
  `RangeError` and a single invalid `snapshots` mode is still a `TypeError`.
- **Behavior change:** options that are not an object or `undefined` now fail
  with `INVALID_OPTIONS`. `new IncrementalJsonScanner(null)` and
  `createStructuredStreamPool(null)` used to throw a `TypeError` without a code,
  and values such as `5` were silently treated as no options. Unknown keys are
  still ignored.
- **Behavior change:** `defineAdapter` sessions now fail with `INTEGRATION_ERROR`
  when the mapper returns a `start`, `delta`, `end`, or `abort` operation whose
  `id` is `undefined`, `null`, or `NaN`. Previously, `{ type: "start", id:
  undefined }` created a call keyed `undefined`, and the next one failed with a
  confusing `DUPLICATE_STREAM`. The message names the operation type. Strings,
  numbers, and other stable keys are unchanged. In TypeScript, a mapper whose
  `id` can be `undefined` or `null` no longer type-checks.
- **Behavior change:** Anthropic and Gemini streams that end right after a tool
  call starts now fail with `INTEGRATION_ERROR` instead of completing the call
  as `{}` (or as Anthropic's initial input). This covers a stream that ends after
  `content_block_start` without `content_block_stop`, or after a Gemini
  `step.start` without `step.stop`, when no argument text has arrived. Calls
  with no arguments that are properly closed still complete as `{}`. LangChain
  is unchanged because its chunks carry no closing event.
- **Behavior change:** Bedrock, Cohere, AG-UI, and Vercel streams that end
  before an empty tool call closes now fail with `INTEGRATION_ERROR` and the
  call's `id`, instead of completing it as `{}`. A call that only received
  `contentBlockStart`, `tool-call-start`, `TOOL_CALL_START`, or
  `tool-input-start` no longer looks like a valid call with no arguments. In
  Vercel, a `finish-step` or `finish` (including `length` and
  `content-filter`) that arrives before `tool-input-end`, `tool-call`, or
  `tool-input-available` fails the same way. Properly closed calls with no
  arguments still complete as `{}`.
- Stop the assistant-stream backend from publishing a value for a malformed
  number. With `initializeAssistantStream()`, a delta such as `"a":01` used to
  report `a: 0`, and that value survived later deltas. Numbers like `01`,
  `-01`, `00`, `-.`, and `1.e1` now fall back to native parsing as soon as they
  become invalid, so arguments and `partialPath` match assistant-stream's own
  `IncrementalJsonObjectParser`.
- Complete tool calls with no argument text as `{}` in the Bedrock, Cohere,
  AG-UI, and Vercel adapters, matching Anthropic, Gemini, LangChain, and the
  `ai` SDK. These calls previously failed with `EMPTY_INPUT`. Received argument
  text must still form valid JSON, and OpenAI Chat Completions still rejects
  empty arguments.
- Keep Wasm memory proportional to the input when a long object key sits above deep nesting or many values. The parser no longer copies key text into every nested frame and patch, so a 1 MB stream with one long key no longer traps after growing memory past 2 GiB. Patches and snapshots are unchanged.
- Parse numbers streamed in small chunks in linear time. Each chunk now extends
  the number instead of rescanning it. Partial values and patches are unchanged.
- Report WebAssembly traps as structured `WASM_TRAP` errors with the original
  `WebAssembly.RuntimeError` as `cause`. New streams use a fresh instance.
  **Behavior change:** the thrown error is now a plain `Error`, so
  `instanceof WebAssembly.RuntimeError` checks must test `error.cause`. Other
  open streams on the crashed instance now fail closed with `WASM_TRAP` on
  their next push or finish.
- Document the copy-on-write cost of immutable snapshots on long arrays, with
  a reproducible benchmark and measured live/immutable medians and p95s.
- Report runtimes that refuse to compile the embedded Wasm module as structured
  `WASM_COMPILE_BLOCKED` errors with the original error as `cause`, instead of
  a raw `CompileError` (or `INTEGRATION_ERROR` from `readStructured`). This
  covers edge isolates such as Cloudflare Workers and Vercel Edge Functions and
  pages whose Content-Security-Policy blocks Wasm, none of which can run
  Streamfold.
- Document what each adapter does at end of stream, with a table that a test
  checks against every adapter. A call whose argument text is already complete
  JSON completes without its closing event in every adapter except OpenAI Chat
  Completions. Correct the docs for whitespace-only Anthropic and Gemini
  arguments, which fail with `EMPTY_INPUT` rather than completing as `{}`, and
  list `WASM_COMPILE_BLOCKED` among the error codes. Behavior is unchanged.

## 0.1.21

- Add `disableAssistantStream()` to unregister the optional shared parser backend, cancel pending initialization, and permit re-enabling without affecting existing parsers.
- Capture `getReader` once when acquiring managed readable sources, preserving accessor behavior and reader cleanup.
- Clear SDK call indexes and completion-deduplication records when managed streams dispose.
- Reject ambient OpenAI custom headers and exclude OpenAI tenant/admin settings in the Groq/Ollama examples and manual smoke checks.
- Verify the tested SDK integrations against `@anthropic-ai/sdk` 1.9.0, `cohere-ai` 8.3.1, `@google/genai` 3.5.0, and `@langchain/core` 1.4.1.
- Add an opt-in manual provider smoke command with request plans, bounded execution, and offline SDK/transport checks for OpenAI, Anthropic, Groq, and Ollama.
- Preserve Mistral incomplete-response reasons and error causes in the maintained Responses example.
- Verify AG-UI client event normalization, error handling, cancellation, and SDK types; document subscriber error propagation.
- Decode embedded Wasm with native byte-array or Buffer base64 support when
  available, retaining the `atob` fallback and existing initialization lifecycle.

## 0.1.20

- Refresh published-package performance evidence with snapshot-mode, startup, and noise controls, and document tested integration boundaries.
- Add a runnable Ollama/Groq Chat Completions example with credential-free SDK protocol fixtures.
- Add `openAIChatCompletions` for streamed Chat Completions function arguments, with interleaved tool calls, strict completion handling, and managed cleanup.
- Add a runnable OpenAI Responses tool-argument preview example with immutable
  snapshots, cancellation, and tests through the SDK's stream decoder.
- Use npm trusted publishing for releases without a stored-token fallback.
- Report the publishing client's version and npm OIDC exchange failures in the
  release log.

## 0.1.19

- Release retained Anthropic initial arguments on terminal failures and managed
  disposal, including failed finalization, cancellation, and early return.
- Capture iterator methods once and normalize read results without repeated
  protocol getter access, preserving native completion and promise behavior.
- Reject missing own paths in live snapshots so consumer-deleted properties
  cannot redirect later patches into inherited objects or getters.
- Match native iterator reads for callable result objects and synchronous
  thenable results, preserving promised events, cleanup, and cancellation.
- Collect Anthropic beta MCP tool inputs through the existing argument parser,
  including initial values, streamed deltas, limits, and block/EOF completion.
- Update existing live string properties directly during appends, reducing
  repeated property definitions while preserving safe keys and descriptor checks.
- Reject invalid iterator cleanup results and preserve native sync/async cleanup
  semantics, original failures, and prompt cancellation.
- Preserve complete Anthropic initial tool inputs when no argument text arrives,
  while retaining delta precedence, strict JSON validation, and parser limits.
- Await synchronous iterator cleanup values on early exit, propagating cleanup
  rejections while preserving original failures and prompt cancellation.
- Reuse one lifetime abort listener for managed reads, preserving cancellation,
  source cleanup and release of consumed payloads.
- Reuse a fulfilled scheduling promise for signalled managed reads, reducing
  allocations while preserving deferred pulls and cancellation ordering.
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
