# Changelog

## Unreleased

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
