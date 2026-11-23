# Architecture

The published `streamfold` package executes the parser in Rust through an
embedded WebAssembly module:

```text
SDK event
  → integration subpath
  → StructuredStreamPool
  → JavaScript Wasm bridge
  → Rust StructuredJsonParser
  → compact binary patches
  → live partial JavaScript value
```

## Runtime boundary

The Rust ABI is defined in `crates/streamfold-core/src/wasm.rs`. It exposes
parser allocation, input-buffer access, push, finish, output, state, error, and
cleanup functions using numeric values and Wasm linear memory.

`packages/core/src/internal/wasm-runtime.js`:

1. lazily instantiates the embedded Wasm module once, replacing it only after
   a trap (open streams on the trapped instance fail with `WASM_TRAP`);
2. encodes each JavaScript fragment directly into a parser-owned Rust buffer;
3. calls the Rust state transition;
4. decodes compact path patches from Wasm linear memory, where each path
   carries only the segments after the prefix it shares with the previous
   patch, so key text crosses the boundary once per key;
5. applies those patches to a live JavaScript value.

The approximately 41 KB Wasm binary is generated into
`packages/core/src/internal/wasm-binary.js`. Embedding it keeps
`createStructuredStream()` synchronous and avoids runtime file loading,
platform-specific native packages, and provider dependencies.

## Why this is not `napi-rs`

Node-API native modules cannot execute in browsers or edge isolates. Streamfold
uses WebAssembly for the default npm path so the same Rust parser runs in
Node.js and in browsers. It compiles the embedded bytes at runtime, which edge
isolates such as Cloudflare Workers and Vercel Edge Functions do not allow:
they only run Wasm modules bundled at deploy time. Pages whose
Content-Security-Policy allows neither `'wasm-unsafe-eval'` nor `'unsafe-eval'`
refuse the same compile. Both fail with `WASM_COMPILE_BLOCKED`. A future
optional `napi-rs` backend could improve Node throughput without changing the
public API.

## Build

```bash
pnpm build:wasm
```

The npm `prepack` lifecycle runs the same build, ensuring the published Wasm
matches the Rust source. Consumers do not need Rust installed.
