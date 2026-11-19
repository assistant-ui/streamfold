# Native base64 decoding at startup

Native decoding reduced first-stream median time against published Streamfold
0.1.20 in these local measurements. Total p95 did not improve in the confirmation
run. This is an initialization change, not a warm-parsing or UI latency claim.

## Method

Measured on 2026-11-19 with Node 24.21.0, Apple M1 and macOS arm64 (Darwin
25.2.0). The baseline is the published 0.1.20 package; the candidate is a packed
copy with native base64 decoding. An independently loaded copy of the candidate
provides an A/A control. Both package manifests still say 0.1.20; the candidate
is an unreleased change, not a second publication of that version.

The measured candidate tarball SHA-256 is
`0ce9d5f0f2e1612c59b412573c886e1c3dc631731cd8f1e4246ba10ab086bb4a`.

```sh
STREAMFOLD_RELEASE_REPORT=artifacts/startup-confirmation.json \
  node --expose-gc benchmarks/release-comparison.mjs \
  /path/to/published-0.1.20/src/index.js /path/to/candidate/src/index.js
```

The existing harness rotates the baseline, candidate and independent control
and reverses their order on alternate rounds. Each startup observation uses a
fresh Node process, no warmups, and the complete 16-byte `{"city":"Paris"}`
fixture. There are 21 observations per package per run. Import and the first
pool/start/push/finish are timed separately; final JSON equality and an empty
pool are checked outside the timer. Node process launch is outside the timer;
filesystem caches can be warm. No samples were discarded or combined across runs.

## Confirmation run

All cells are median / p95 milliseconds.

| Package | Import | First stream | Total |
| --- | ---: | ---: | ---: |
| Published 0.1.20 | 2.6790 / 3.2576 | 2.2363 / 2.5915 | 4.9177 / 5.8491 |
| Native decoding | 2.6347 / 3.6985 | 1.7856 / 2.1427 | 4.4431 / 6.2365 |
| Independent candidate control | 2.6031 / 3.1147 | 1.7968 / 1.9546 | 4.4040 / 5.0876 |

First-stream median decreased by about 0.45 ms (20%); the two identical candidate
copies differ by about 0.01 ms. Total median decreased by about 0.47 ms (10%).
The candidate's total p95 is worse than the baseline, and its independent
control has a different tail. These samples do not establish a total p95 win.

An earlier diagnostic run independently measured first-stream medians of
2.1955 ms, 1.7497 ms and 1.7355 ms for baseline, candidate and control, respectively.
Its complete results are retained separately. A browser smoke test overlapped
the beginning of that run's warm benchmarks; those warm timings are not used
to claim a performance improvement.

## Small inputs and compatibility

The confirmation run also executes all six existing warm fixtures, including
16-byte one-chunk and four-chunk inputs, with seven warmup batches and 28 measured
batches. It checks every partial value and final result against the SDK parsers.
Native decoding runs only during initialization. There is no new one-shot
`JSON.parse` path, and no warm-parsing improvement is claimed. The existing
recommendation to avoid incremental parsing for one-shot JSON still applies.

The runtime prefers `Uint8Array.fromBase64`, then an available `Buffer.from`,
then the existing `atob` and byte-copy loop. Node in this measurement uses the
Buffer path. Tests exercise both synchronous and prepared initialization through
all three paths, including Unicode values and reuse without decoding again.
The typed-array path is simulated in Node; the production Chrome smoke also
passes with the browser's native APIs. Older runtimes retain the fallback.

Raw reports remain in the local ignored artifacts directory as
`startup-comparison.json` and `startup-confirmation.json`. These are local
parser measurements, not serverless cold-start, provider latency or application
performance guarantees. Windows, Firefox and WebKit were not rerun locally.
