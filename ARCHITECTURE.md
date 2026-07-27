# Architecture

The published `streamfold` package executes the parser in Rust through an
embedded WebAssembly module:

```text
SDK event
  → integration subpath
  → StructuredStreamPool
  → JavaScript Wasm bridge
  → Rust JsonStreamParser
  → structural StreamState
```

## Runtime boundary

The Rust ABI is defined in `crates/streamfold-core/src/wasm.rs`. It exposes
parser allocation, input-buffer access, push, finish, state, error, and cleanup
functions using numeric values and Wasm linear memory.

`packages/core/src/internal/wasm-runtime.js`:

1. lazily instantiates the embedded Wasm module once;
2. encodes each JavaScript fragment directly into a parser-owned Rust buffer;
3. calls the Rust state transition;
4. translates the packed state or error into the public JavaScript API.

The approximately 20 KB Wasm binary is generated into
`packages/core/src/internal/wasm-binary.js`. Embedding it keeps
`createStructuredStream()` synchronous and avoids runtime file loading,
platform-specific native packages, and provider dependencies.

## Why this is not `napi-rs`

Node-API native modules cannot execute in browsers or edge isolates. Streamfold
uses WebAssembly for the default npm path so the same Rust parser can run in
browser and server runtimes. A future optional `napi-rs` backend could improve
Node throughput without changing the public API.

## Build

```bash
pnpm build:wasm
```

The npm `prepack` lifecycle runs the same build, ensuring the published Wasm
matches the Rust source. Consumers do not need Rust installed.
