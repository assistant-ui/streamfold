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

For string-parser changes, run `pnpm bench:strings /path/to/baseline/src/index.js`
against an unpacked baseline package. It alternates the two implementations on
identical ASCII, Unicode, and escaped strings with live and immutable snapshots,
checks final values, and records medians and p95s in `artifacts/string-runs.json`.

For snapshot changes, run `pnpm bench:snapshots /path/to/baseline/src/index.js`.
It compares dense arrays, nested arrays, and dense objects in both snapshot modes,
checks every partial value, and records medians and p95s in `artifacts/snapshots.json`.

For numeric-parser changes, run `node benchmarks/number-prefixes.mjs
/path/to/baseline/src/index.js`. It compares valid integers and malformed
exponents with matching partial values and final validation, recording medians
and p95s in `artifacts/number-prefixes.json`.

For completion-tracking changes, run `pnpm bench:completion-memory
/path/to/baseline/src/index.js`. It compares retained JavaScript heap in fresh
Node processes after explicit garbage collection, with 16 streams of 2,000
nested records in both snapshot modes. It checks field states and final values
and records three alternating trials in `artifacts/completion-memory.json`.

For pool finalization changes, run `pnpm bench:final-value-memory
/path/to/baseline/src/index.js`. It measures retained JavaScript heap for 16
completed results containing 2,000 nested records each, in live and immutable
modes. Three alternating trials use fresh Node processes and explicit garbage
collection, with final values checked against the source JSON. Results are
written to `artifacts/final-value-memory.json`.

The standalone assistant-ui demo has its own locked dependencies. CI runs its
unit tests, production build, and browser tests against both the pinned npm
release and a freshly built tarball from the commit under test. The candidate
lane runs the package's `prepack` WASM build and installs the tarball without
changing the demo's manifest or lockfile.
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

Releases publish through `.github/workflows/release.yml` with provenance.
For token authentication, save a publishing token as the `NPM_TOKEN` secret
in the GitHub environment named `npm`. The workflow exposes it only to the
publish step through a temporary npm configuration. Never commit the token.
Without that secret, npm can use trusted publishing; its configuration must
match this repository, the `release.yml` workflow, and the `npm` environment.

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

If a tagged release failed and needs a workflow fix, merge the fix first,
then run `gh workflow run release.yml --ref main`. This retry uses the
current package version and requires its existing tag to be an ancestor of
`main`, with identical package source and build inputs. It builds `main`
so provenance identifies the actual build commit. It never moves the tag,
and it skips npm publication if that version already exists. An existing
GitHub release draft remains a draft until a maintainer publishes it after
verifying the npm package.

After dispatching a retry, run `pnpm release:await` from a checkout with the
version being released. The waiter selects the latest matching tag run or
manual retry on `main`, checking the retry commit's package version. It resolves
the tag through GitHub, so workflow-fix commits and checkouts without local tags
can wait for the same release. A failed retry still exits with failure; a
successful run must also be visible on npm before the command reports success.
