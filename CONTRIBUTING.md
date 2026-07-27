# Contributing

Streamfold is an early, benchmark-backed prototype. Issues and focused pull
requests are welcome, especially for correctness fixtures, incremental value
materialization, and browser/server portability.

## Setup

Install Node.js 22 or newer, pnpm 11, and the pinned Rust toolchain. Rustup
installs the required `wasm32-unknown-unknown` target from `rust-toolchain.toml`.

```bash
pnpm install
pnpm build:wasm
pnpm check
```

Run the performance suites separately:

```bash
pnpm bench
pnpm bench:sdk
```

Benchmarks write machine-local results under `artifacts/`; generated JSON and
video files are intentionally ignored.

## Pull requests

- Keep each change focused and include tests for behavioral changes.
- Preserve event-envelope fixtures when changing an integration.
- Report the environment, payload size, chunk size, warmups, median, and p95
  when making performance claims.
- Do not claim a drop-in speedup unless both implementations expose equivalent
  partial and final values.
- Do not add provider SDKs as runtime dependencies. Integrations consume
  structural event shapes and remain independently importable.

Commit the regenerated `packages/core/src/internal/wasm-binary.js` whenever the
Rust core changes. Run `pnpm check` and `pnpm pack:check` before opening a pull
request.
