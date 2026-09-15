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

The standalone assistant-ui demo has its own locked dependencies and CI job.
From `examples/assistant-ui-demo`, run `npm ci`, `npm test`, and `npm run build`.
Start a production preview on port 4173 and run `npm run test:browser` to check
the UI. Set `CHROME_EXECUTABLE` to use an installed Chrome binary instead of
Playwright's bundled Chromium; core browser tests accept the same override.

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

## Maintainer releases

Releases publish through `.github/workflows/release.yml` using npm trusted
publishing. The npm trusted publisher must match this repository, the
`release.yml` workflow, and the GitHub environment named `npm`.

Start from a clean, up-to-date `main`. Update the **Unreleased** changelog for
the version being prepared, then run the release checks:

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm test:browser
```

When ready to publish, use `pnpm release` (or `pnpm release:beta`). This bumps
both package versions, checks the package, commits, tags, and pushes before
waiting for publication.
A release tag must point to a commit contained in `origin/main`. To resume
waiting for an already-pushed release, use `pnpm release:await` from its commit.
