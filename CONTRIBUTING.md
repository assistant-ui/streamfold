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

For published-release comparisons, follow the setup in
[`benchmarks/SDK_ADAPTER_REPORT.md`](benchmarks/SDK_ADAPTER_REPORT.md), then run
`node --expose-gc benchmarks/release-comparison.mjs <baseline-src/index.js>
<candidate-src/index.js>`. It checks every fixture prefix, rotates before/after
and independent identical-copy controls, retains all samples, and measures
fresh-process import/first-stream costs separately. The old release has no
immutable snapshot mode; only its live mode is compared. Current immutable
costs are measured explicitly. Raw results remain in ignored `artifacts/`.

For managed reader changes, run `node benchmarks/managed-reads.mjs
/path/to/baseline/src/index.js`. It compares arrays, async iterators, and reader-only
streams, with and without an abort signal, using ignored events and real tool
updates. Output parity and cleanup are checked outside rotating A/A/B timings.
Run it separately with `--allocations` to count promises using `async_hooks`.
Use `--listeners` in a separate run to count abort-listener additions/removals
and verify that completed sources retain no abort listeners.
Use `--scheduling` against a baseline before scheduling-promise reuse to verify
one fewer allocation per signalled event and unchanged unsignalled counts.
Check timing noise with independently loaded identical package copies as well
as the repeated baseline. If those controls shift similarly, report timing
as inconclusive rather than claiming a speedup.
Raw samples, median/p95, controls, and counts go to `artifacts/managed-read*.json`.

For string-parser changes, run `pnpm bench:strings /path/to/baseline/src/index.js`
against an unpacked baseline package. It alternates the two implementations on
identical ASCII, Unicode, and escaped strings with live and immutable snapshots,
checks every partial update and field state before timing, validates final
values after timing, and records medians and p95s in `artifacts/string-runs.json`.

For property-key decoding changes, run `node benchmarks/property-keys.mjs
/path/to/baseline/src/index.js`. It compares short keys, long ASCII and Unicode
keys, escaped lone surrogates, and literal replacement characters in both
snapshot modes. Partial values, patches, field states, and final values must
match; alternating timings are written to `artifacts/property-keys.json`.

For snapshot changes, run `pnpm bench:snapshots /path/to/baseline/src/index.js`.
It compares dense arrays, nested arrays, and dense objects in both snapshot modes,
checks every partial value, and records medians and p95s in `artifacts/snapshots.json`.

To measure what immutable snapshots cost as one array grows, run `node
benchmarks/snapshot-array-growth.mjs`. It streams 1,000, 4,000, and 16,000
records in 8- and 256-byte chunks and checks that live and immutable partial
values match. It then rotates live, immutable, and a repeated live control, and
records raw samples, medians, and p95s in `artifacts/snapshot-array-growth.json`.

For live property updates, run `node benchmarks/live-properties.mjs
/path/to/baseline/src/index.js /path/to/independent-baseline-copy/src/index.js`.
Use two identical package copies so the A/A control loads independently. The
benchmark checks partial values, patches, field states, and final values before
rotating A/control/B timings for string appends, duplicate keys, new properties,
new array items, and root-string controls in both snapshot modes. An optional
third package entry replaces the candidate for an all-identical control run.
Run separately with `--definitions` to count `Object.defineProperty` calls;
these are operation counts, not heap allocations. Raw samples, median/p95, and
environment details go to `artifacts/live-properties.json`; operation counts go
to `artifacts/live-property-definitions.json`. Preserve each output before the
next run and report control noise and regressions alongside improvements.

For immutable patch traversal, run `node benchmarks/immutable-paths.mjs
/path/to/baseline/src/index.js`. It compares whole and chunked arrays, nested
records, and root-string controls in both snapshot modes with rotating A/A/B
timings, output parity, and raw median/p95 samples. Run the same command with
`--allocations` in a separate process to count temporary path arrays without
instrumenting timings. Results are saved under `artifacts/immutable-path*.json`.

For numeric-parser changes, run `node benchmarks/number-prefixes.mjs
/path/to/baseline/src/index.js`. It compares valid integers and malformed
exponents with matching partial values and final validation, recording medians
and p95s in `artifacts/number-prefixes.json`.

For streamed-number changes, run `node benchmarks/streamed-numbers.mjs
/path/to/baseline/src/index.js`. It compares long fractional prefixes and ordinary
numeric records with 16- and 512-character chunks in both snapshot modes. Every
prefix's value, patches, and field state are checked before alternating timed
runs; final values are checked against JSON.parse. Medians and p95s are written
to `artifacts/streamed-numbers.json`.

For empty-delta parser changes, run `node benchmarks/empty-deltas.mjs
/path/to/baseline/src/index.js`. It compares empty updates during pending numeric
values against an ordinary string control, verifies partial updates and field
states, and records median and p95 parsing time in `artifacts/empty-deltas.json`.
It also measures unchanged object snapshots and repeats the baseline as an A/A
control to show timing noise alongside the candidate.

For pool input-storage changes, run `node benchmarks/empty-deltas-memory.mjs
/path/to/baseline/src/index.js`. It measures retained JavaScript heap in fresh
Node processes after explicit garbage collection, comparing active pools fed
100,000 and 500,000 empty deltas in both snapshot modes. Three alternating trials
check byte counts, updates, and final text; results are written to
`artifacts/empty-deltas-memory.json`.

For completion-tracking changes, run `pnpm bench:completion-memory
/path/to/baseline/src/index.js`. It compares retained JavaScript heap in fresh
Node processes after explicit garbage collection, with 16 streams of 2,000
nested records in both snapshot modes. It checks field states and final values
and records three alternating trials in `artifacts/completion-memory.json`.

Run `node benchmarks/completion-batches.mjs /path/to/baseline/src/index.js` to
compare parsing time for whole-document batches, 1,024-character chunks, and an
ordinary string control in both snapshot modes. It checks partial values,
patches, and field states before timing, validates final values, and records
median, p95, raw samples, and an A/A baseline repeat in
`artifacts/completion-batches.json`.

For pool finalization changes, run `pnpm bench:final-value-memory
/path/to/baseline/src/index.js`. It measures retained JavaScript heap for 16
completed results containing 2,000 nested records each, in live and immutable
modes. Three alternating trials use fresh Node processes and explicit garbage
collection, with final values checked against the source JSON. Results are
written to `artifacts/final-value-memory.json`.

For scanner finalization changes, run `pnpm bench:finished-memory
/path/to/baseline/src/index.js`. It retains 32 finished scanners with 2,000 nested
records each, comparing 4,096-character chunks and single-chunk input in both
snapshot modes. Three alternating trials use fresh processes without warmups
and verify final values, field queries, and repeated operations. The results in
`artifacts/finished-scanner-memory.json` measure Wasm linear-memory high-water
allocation, not JavaScript heap or process RSS.

The standalone assistant-ui demo has its own locked dependencies. CI runs its
unit tests, production build, and browser tests against both the pinned npm
release and a freshly built tarball from the commit under test. The candidate
lane runs the package's `prepack` WASM build and installs the tarball without
changing the demo's manifest or lockfile.
From `examples/assistant-ui-demo`, run `npm ci`, `npm test`, and `npm run build`.
Start a production preview on port 4173 and run `npm run test:browser` to check
the UI. Set `CHROME_EXECUTABLE` to use an installed Chrome binary instead of
Playwright's bundled Chromium; core browser tests accept the same override.

For Anthropic input cleanup, run `node benchmarks/anthropic-retention.mjs
/path/to/baseline/src/index.js`. It retains failed integrations with eight
1 MiB initial inputs, verifies terminal errors and empty pools, and compares
retained heap after garbage collection in fresh Node processes. Three alternating
A/control/B trials include a repeated baseline and a small-delta control that
replaces initial input before failure. Results and environment details go to
`artifacts/anthropic-retention.json`.

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

Releases publish through `.github/workflows/release.yml` using npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) with provenance.
The npm package's trusted publisher must allow direct `npm publish` from GitHub
organization `assistant-ui`, repository `streamfold`, workflow `release.yml`,
and environment `npm`. The workflow grants `id-token: write` and installs a
compatible npm client so npm can exchange the GitHub identity for a short-lived
publishing credential. It does not read `NPM_TOKEN` or create a token npmrc.
If authentication fails, check the trusted publisher settings and permissions
on npm rather than adding a publishing token to the workflow. The publish step
invokes the installed npm client directly, reports its version, and includes
npm's OIDC exchange diagnostics in the release log.

Start from a clean, up-to-date `main`. Update the **Unreleased** changelog for
the version being prepared, then run the release checks:

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm test:browser
```

When ready to publish, use `pnpm release` (or `pnpm release:beta`). This bumps
both package versions, checks the package, commits, and pushes the release
commit to `main`, then waits for publication. Releases publish only from
`main`; the workflow never runs from a tag. Pushing the version bump starts
the Release workflow, which builds and packs the package, waits for approval
in the `npm` environment, publishes, and then creates the `v<version>` tag and
GitHub release at the published commit.

A run publishes the version on `main` only if npm does not have it yet and the
package source and build inputs are unchanged since the commit that bumped the
version. If later commits changed them, bump the version again. To resume
waiting for a release, use `pnpm release:await` from its commit.

If a release failed and needs a workflow fix, merge the fix first, then run
`gh workflow run release.yml --ref main`. This retry builds `main`, so
provenance identifies the actual build commit. It skips npm publication if the
version already exists and only adds a missing tag or GitHub release.

After dispatching a retry, run `pnpm release:await` from a checkout with the
version being released. The waiter finds the commit that set that version, as
the workflow does, and selects the latest Release run on `main` that is either
the push of that commit or a manual retry at that version. A later push that
keeps the version is not the release, so the waiter ignores it. A failed run
still exits with failure; a successful run must also be visible on npm before
the command reports success.
Npm verification retries for up to five minutes, with increasing delays capped
at 30 seconds and each query limited to the remaining window or 30 seconds.
If verification times out, the command exits with failure, preserves the last
npm error, and identifies the successful workflow separately. Run
`pnpm release:await` again to verify the existing version without publishing
another release.
