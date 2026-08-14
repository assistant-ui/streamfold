# Contributing

Issues and focused pull requests are welcome. By participating, you agree to
follow the [code of conduct](CODE_OF_CONDUCT.md).

## Setup

Install Node.js 22+, pnpm 11, and Rustup. The pinned Rust toolchain includes the
`wasm32-unknown-unknown` target.

```bash
pnpm install
pnpm check
pnpm pack:check
```

Install a browser with `pnpm exec playwright install chromium`, then run browser
tests with `pnpm test:browser`. Performance work should also run `pnpm bench`
and `pnpm bench:sdk`; results are written to the ignored `artifacts/`
directory.

## Pull requests

- Keep one concern per pull request.
- Add tests for behavior changes and update affected docs.
- Keep provider SDKs out of runtime dependencies; adapters use structural
  event shapes.
- Include the environment, payload, chunk size, warmups, median, and p95 with
  performance claims.
- Compare equivalent partial and final values when claiming a speedup.

Rust changes must include the regenerated
`packages/core/src/internal/wasm-binary.js`. Run `pnpm check` and
`pnpm pack:check` before opening the pull request.
