# Published package performance

Published Streamfold 0.1.19 reduces parser time on the tested fragmented JSON
streams. It costs more than the existing SDK parsers for tiny one-chunk input,
and fresh-process import plus first parse is slower than 0.1.1. These are local
measurements of fixed fixtures, not provider latency or application guarantees.

## Artifacts and environment

- Measured on 2026-11-18: Apple M1, macOS arm64 (Darwin 25.2.0), Node 24.21.0.
- npm packages: Streamfold 0.1.1 and 0.1.19, assistant-stream 0.3.54, Vercel AI SDK 7.0.166.
- Both Streamfold versions were installed from npm with lifecycle scripts disabled.
- The candidate A/A control is an independent copy of the same installed 0.1.19 package, with its own module and Wasm instance.

Registry SHA-512 integrity for 0.1.19:

```text
sha512-du2kp19IqITb4CyfaHewKY4QNuPGH3UflbJEfFVgZvoDxVZ3I2VWEN6RB/gnGJ08kB3FZ40hrGcpw6xdpYE2Sw==
```

Registry SHA-512 integrity for 0.1.1:

```text
sha512-+bVJfbiuWqXagmjmjw6SPDrDIgBYCHtkKVo1keunqFeYlsSDsxPjNzcNrCVJZW7+4lb9+sHPLzPiSPlo8ftaFw==
```

The 0.1.19 release was manually published without npm provenance. Integrity
identifies the measured artifact; it is not a provenance attestation.

## Warm parsing

Each cell is **median / p95 milliseconds per completed argument stream**.
Streamfold timings include pool/parser creation, every push, partial-value
materialization, final validation, finalization, and parser disposal. SDK timings
use the real accumulated-prefix partial parsers. They are not one final
`JSON.parse` measurements. All paths produce equal partial JSON values at every
fixture boundary and equal final values.

| Payload / chunk | Deltas | 0.1.1 live | 0.1.19 live | 0.1.19 immutable | assistant-stream parser | Vercel parser |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 B / 4 chars | 4 | 0.0053 / 0.0084 | 0.0045 / 0.0079 | 0.0043 / 0.0076 | 0.0060 / 0.0089 | 0.0233 / 0.0262 |
| 16 B / 4,096 chars | 1 | 0.0038 / 0.0070 | 0.0034 / 0.0050 | 0.0031 / 0.0056 | 0.0004 / 0.0005 | 0.0006 / 0.0008 |
| 801 B / 16 chars | 51 | 0.1034 / 0.1323 | 0.0843 / 0.1207 | 0.0999 / 0.1302 | 0.4420 / 0.5082 | 0.5850 / 0.6660 |
| 801 B / 256 chars | 4 | 0.0632 / 0.0690 | 0.0534 / 0.0748 | 0.0539 / 0.0588 | 0.0347 / 0.0373 | 0.0424 / 0.0446 |
| 48,501 B / 16 chars | 3,032 | 5.583 / 7.058 | 4.694 / 5.927 | 6.324 / 7.157 | 1135.340 / 1194.012 | 839.675 / 900.905 |
| 48,501 B / 4,096 chars | 12 | 3.426 / 3.902 | 2.851 / 3.282 | 2.849 / 3.170 | 4.432 / 4.505 | 3.295 / 3.523 |

The tiny fixture is `{"city":"Paris"}`. The record fixtures contain an array of
10 or 600 objects with string `id`, `city`, and `summary` fields. All payloads
are ASCII, so character and byte chunk sizes coincide. This does not measure
every JSON shape or Unicode workload.

For 48,501 bytes in 3,032 deltas, the live path measures 4.695 ms versus
5.583 ms for 0.1.1. Immutable snapshots cost 6.324 ms on that same fixture.
The corresponding SDK medians are 1,135.340 and 839.675 ms. This comparison
isolates repeated parsing/materialization, not a full SDK request or UI update.

For the 16-byte single chunk, SDK medians are 0.00043 and 0.00056 ms versus
0.00345 ms for Streamfold live mode. For 801 bytes in four chunks, both SDK
parsers also beat Streamfold. Use incremental parsing when partial values
are needed; do not add it to one-shot JSON for a presumed speed benefit.

## Sampling and noise

- Seven warmup batches and 28 measured batches per path and case.
- Rotate all seven paths and reverse their order on alternating rounds.
- Batches: 100 streams for tiny input, 10 for 801-byte input, one for 48,501-byte input. Report per-stream batch time.
- Include one `await` per replay for every path; Vercel also awaits each public partial-parser call.
- Check every prefix before timing and final values after every timed batch. Assertions are outside timing.
- Independently loaded 0.1.19 copies provide live and immutable A/A controls.
- Median is the upper middle sorted sample; p95 uses nearest rank.
- No measured samples were discarded. Raw per-batch timings are retained.

| Payload / chunk | Live A / control median (ms) | Difference | Immutable A / control median (ms) | Difference |
| --- | ---: | ---: | ---: | ---: |
| 16 B / 4 chars | 0.0045 / 0.0042 | 5.4% | 0.0043 / 0.0049 | 12.5% |
| 16 B / 4,096 chars | 0.0034 / 0.0035 | 0.1% | 0.0031 / 0.0027 | 12.7% |
| 801 B / 16 chars | 0.0843 / 0.0840 | 0.3% | 0.0999 / 0.1045 | 4.5% |
| 801 B / 256 chars | 0.0534 / 0.0515 | 3.4% | 0.0539 / 0.0539 | 0.1% |
| 48,501 B / 16 chars | 4.694 / 4.726 | 0.7% | 6.324 / 5.941 | 6.1% |
| 48,501 B / 4,096 chars | 2.851 / 2.861 | 0.4% | 2.849 / 2.861 | 0.4% |

Identical copies differ by up to about 13% for tiny immutable timings. Do not
rank live versus immutable from those microsecond differences. A/A differences
also limit claims about small improvements. Large fragmented SDK-versus-core
differences are much larger than the observed control spread. The report does
not attribute version differences to any single optimization.

## Fresh-process startup

Each sample starts a fresh Node process, imports the core, then creates a pool
and parses the same complete 16-byte object. There are 21 samples per package,
rotating/reversing package order, with no warmups. Node process startup is
outside the timer; OS filesystem caches may already be warm. These measurements
are not a cold-machine or serverless cold-start guarantee.

| Package | Import median / p95 (ms) | First stream median / p95 (ms) | Total median / p95 (ms) |
| --- | ---: | ---: | ---: |
| 0.1.1 | 1.073 / 1.121 | 2.098 / 2.296 | 3.178 / 3.384 |
| 0.1.19 | 2.732 / 2.937 | 2.501 / 2.550 | 5.205 / 5.486 |
| 0.1.19 independent control | 2.647 / 3.258 | 2.214 / 2.336 | 4.853 / 6.339 |

The candidate total median is 5.205 ms versus 3.178 ms for 0.1.1. Its independent
control measures 4.853 ms. The extra startup work is a cost, even though warm
fragmented parsing is faster in these fixtures.

## Production demo rendering

The production build from [demo PR #164](https://github.com/assistant-ui/streamfold/pull/164)
uses npm Streamfold 0.1.19, assistant-stream 0.3.54, assistant-ui/react 0.15.32,
and React 19.3.1. Chrome 157.0.8103.79 ran at 1440 × 1100 with the normal
180 ms event delay. Five fresh pages per scenario each ran one playback and
one replay after reset: **20 verified playbacks**, all with correct final
arguments and no page errors. The page prepares both parsers during idle time
before playback; these are not cold-start samples.

The following Chrome DevTools Protocol counters include **both panes**, React
execution, style, layout, animations, and other page tasks through two animation
frames after completion. They cannot assign rendering costs to one parser.
Task time overlaps its components; do not add these columns together.
Cells are median / p95 milliseconds. With only five samples per row, nearest-rank
p95 is the maximum observed sample, not a reliable production tail estimate.

| Scenario / phase | Script work | Layout | Style recalculation | All page tasks |
| --- | ---: | ---: | ---: | ---: |
| weather / first | 148.64 / 248.13 | 48.24 / 63.78 | 27.25 / 41.62 | 406.30 / 616.88 |
| weather / replay | 246.59 / 250.27 | 45.42 / 47.78 | 39.61 / 40.80 | 570.61 / 579.66 |
| trip / first | 573.86 / 595.02 | 132.08 / 136.65 | 117.41 / 123.90 | 1721.52 / 1759.29 |
| trip / replay | 585.30 / 594.40 | 137.34 / 141.51 | 136.16 / 142.04 | 1846.74 / 1916.43 |

Parser counters from those same real UI playbacks are shown separately. They
sum short per-event timing intervals and are subject to browser timer precision.
The first/replay observations are not isolated, randomized per-parser UI trials.

| Scenario / phase | Existing parser | Streamfold immutable | Existing playback elapsed | Streamfold playback elapsed |
| --- | ---: | ---: | ---: | ---: |
| weather / first | 2.00 / 3.20 | 1.50 / 2.30 | 3786.10 / 3786.20 | 3786.20 / 3786.40 |
| weather / replay | 2.40 / 2.40 | 2.20 / 2.70 | 3781.70 / 3782.40 | 3781.80 / 3782.50 |
| trip / first | 8.20 / 8.90 | 7.70 / 8.60 | 12784.40 / 12784.60 | 12784.60 / 12784.80 |
| trip / replay | 9.70 / 10.10 | 8.90 / 9.80 | 12782.00 / 12782.30 | 12782.10 / 12782.50 |

Elapsed playback remains about 3.8 seconds for weather and 12.8 seconds for the
trip on both sides. The scheduled event delay dominates that measurement.
**This run does not establish an end-to-end UI speedup.** It records rendering
work that parser-only microbenchmarks exclude.

To reproduce this exact dependency combination, use the demo update in #164
(or a later revision that contains its 0.1.19 lockfile), run `npm ci`,
`npm run build`, and serve that production build with
`npm exec vite -- preview --host 127.0.0.1 --port 4173 --strictPort`.
From this report checkout, run:

```bash
CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
PLAYBACK_SAMPLES=5 \
PLAYBACK_REPORT=artifacts/paced-playback.json \
node --experimental-strip-types examples/assistant-ui-demo/scripts/benchmark-playback.mjs
```

Use `DEMO_URL` for another preview address. The browser closes after the run.
Raw results retain every page/phase observation. No model or network request
to an LLM provider is involved.

## Reproduce

```bash
pnpm install --frozen-lockfile
mkdir -p artifacts/release-packages
printf '{"private":true,"type":"module"}\n' > artifacts/release-packages/package.json
npm install --prefix artifacts/release-packages --ignore-scripts --no-audit --no-fund --save-exact \
  streamfold-before@npm:streamfold@0.1.1 streamfold-after@npm:streamfold@0.1.19
node --expose-gc benchmarks/release-comparison.mjs \
  artifacts/release-packages/node_modules/streamfold-before/src/index.js \
  artifacts/release-packages/node_modules/streamfold-after/src/index.js
```

The runner retains its independent control under ignored `artifacts/release-control-*`
and writes all measured samples to `artifacts/release-comparison.json`.
The runner refuses to overwrite an existing report. Set
`STREAMFOLD_RELEASE_REPORT` to a new path for each complete run. Keep the
npm lockfile alongside each run to record tarball resolution and integrity.

The older `pnpm bench:published 0.1.19` command still exercises the legacy core
and adapter suites. Its separately ordered batches do not have the A/A controls
above; do not combine its results with this report or infer tiny adapter rankings.
It accepts an exact version or a dist-tag and rejects ranges. It checks that
the installed package has the requested version and the registry's
`dist.integrity` before running, and writes `artifacts/published-*.json` only
after both suites finish.

## Scope and compatibility

This report replaces the earlier 0.1.1-only report. The fixtures, SDK versions,
and method changed, so the old report is not a controlled historical comparison.
The 0.1.1 column here was rerun in the same experiment as 0.1.19.

No model/network/SSE latency, tool execution, schema validation, serverless
platform, or live provider speed was measured. The warm table excludes event
adapter overhead and React rendering. Snapshot modes are explicit; live values
mutate in place while immutable values retain earlier snapshots.

See the [integration matrix](../INTEGRATIONS.md) for exact tested SDKs and the
separate status of released event adapters and proposed host parser hooks.
Neither an adapter benchmark nor a proposed hook proves an end-to-end speedup.
