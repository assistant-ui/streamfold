# assistant-ui + Streamfold

Live demo: [weather assistant](https://streamfold-assistant-ui-demo.vercel.app/?view=single),
[complex tools](https://streamfold-assistant-ui-demo.vercel.app/?view=complex),
and [with/without comparison](https://streamfold-assistant-ui-demo.vercel.app/?view=compare).

A standalone, local demo of the published `streamfold@0.1.6` adapter feeding
real `@assistant-ui/react` runtime and tool-rendering primitives. It does not
modify assistant-ui or depend on the separate internal-reader prototype.

The weather view uses assistant-ui's existing animated **WeatherWidget**. The
**Complex tools** view combines it with the existing **Chart**, **Timeline**, and
**DataTable** components. Their MIT-licensed source is included in this demo;
see [component provenance](./src/components/UPSTREAM.md).

```sh
cd examples/assistant-ui-demo
npm install
npm run dev
```

Open the Vite URL and choose **Play both** to compare assistant-ui with and
without Streamfold. **Pause** holds the current event; **Step** advances one
event; **Stop** releases the parsers and preserves partial arguments. Reset
starts a fresh comparison. The scenario menu includes concurrent tool calls
and malformed JSON.

Both columns use the same assistant-ui message and weather components. The
baseline calls assistant-stream's published `parsePartialJsonObject` with all
argument text accumulated so far. Streamfold's published assistant-ui adapter
passes only each new text delta into the incremental scanner. The counters
measure UTF-8 bytes passed to parsing calls; they do not measure execution time,
memory usage, or an end-to-end UI speedup. Separate live timers above each
conversation show **Playback time** in seconds and **Live parser work** in
milliseconds. A failed parser stops independently, so error cases can have
counters covering different events.

Playback time starts at Play, updates every 50 ms, excludes pauses, and freezes
at completion, cancellation, or error. Manual steps add their processing time
without counting the wait between clicks. Reset or changing scenarios clears
both clocks. Live parser work sums `performance.now()` measurements around
the same `parser-runner.push(event)` boundary on both sides: event routing,
argument-text accumulation, partial values, and finalization. Streamfold uses
its event adapter and immutable snapshots. The first call in a browser context
also includes lazy WASM compilation/instantiation. The breakdown separates
text deltas from start/finish events. Execution order alternates each event.
React rendering, inspector counters, schema validation, and tools are excluded.

These are individual live observations affected by timer precision, startup,
and garbage collection. In the investigated Chrome session the clock advanced
in approximately 0.1 ms steps; many individual parser calls were shorter than
that. Totals can show 0.0 ms or favor either side. A cold 95-byte weather run
measured 5.3 ms for Streamfold versus 1.5 ms for the baseline under the previous
timer boundary. Startup is a real cost, and Streamfold is not guaranteed to
be faster for small arguments. Those old live readings also timed
only the baseline function versus the entire Streamfold adapter; both now
use the same event-processing boundary.

**Run repeated benchmark**, above the comparison, runs the selected valid
fixture in a fresh worker using the same parser runners. It checks final values
against `JSON.parse`, reports the first complete replay including startup,
warms both parsers, then measures 15 alternating batches. Both use the same
batch size, calibrated to at least 8 ms per batch when possible (up to 256
replays). The warm median/p95 describe batch averages per complete replay and
exclude initial engine startup. Timing a whole batch reduces clock rounding
noise; neither parser is guaranteed to win. The worker excludes playback delay,
React rendering, and tool execution, and includes runner creation and teardown
for every replay. Pause playback to run it; Cancel, Reset, or changing the
scenario terminates the worker. Playback is disabled while measuring.

### Why both sides finish together

`Comparison.tsx` uses one timer (180 ms per event by default). Each tick calls
`comparison.next()`, which gives the same event to both parsers synchronously,
then publishes one React update for both columns. Both get the finish event on
the same tick. Playback demonstrates partial values and parser inputs; it is
not a race or a measurement of response latency.

Streamfold can reduce the processing time spent reparsing growing arguments.
It cannot make the model or network deliver the next chunk sooner. A small
weather object takes a fraction of a millisecond to parse either way, so the
shared source delay dominates. Larger arguments and smaller chunks expose
more repeated work in the baseline. Rendering, immutable snapshot creation,
and tool execution also have costs, so fewer input bytes do not translate
directly into an equal response-time improvement.

Run the separate parser benchmark without the playback delays:

```sh
npm run bench:parsers
```

It uses the installed demo dependencies, the weather/trip fixtures, and larger
nested JSON fixtures. Both paths produce partial values on every delta;
Streamfold uses the same immutable snapshot setting as the UI. Final values
are checked against `JSON.parse` before timing. Each parser gets five warmup
batches and 25 measured batches in alternating order. Reported milliseconds
are median batch averages per complete stream, including parser setup,
event handling, argument-text accumulation, and finalization. Initial module
loading, React rendering, schema validation, tool execution, and network/model
latency are excluded. This does not benchmark assistant-ui's internal reader.

The command writes environment details, median/p95 measurements, and fixture
sizes to `artifacts/assistant-ui-demo/parser-timing-results.json` at the
repository root. A baseline/Streamfold ratio below 1 means Streamfold was
slower for that case; results depend on hardware, runtime, and payload shape.

Example local run on Apple M1, Node 23.11.0, Streamfold 0.1.6, and
assistant-stream 0.3.42 (2026-09-15 UTC):

| Input | Baseline median | Streamfold median |
| --- | ---: | ---: |
| Weather, 95 bytes / 19 deltas | 0.084 ms | 0.031 ms |
| Trip planner, 2,279 bytes / 65 deltas | 0.828 ms | 0.426 ms |
| Nested JSON, 4,111 bytes / 129 deltas | 5.281 ms | 0.942 ms |
| Nested JSON, 48,071 bytes / 1,503 deltas | 663.375 ms | 17.461 ms |
| Same 48,071 bytes / 188 larger deltas | 83.421 ms | 8.854 ms |

The weather fixture saves roughly 0.05 ms across the entire argument stream.
That is far smaller than even one 180 ms playback tick. The larger synthetic
case shows a processing-time opportunity, not a guaranteed response-time
speedup. Run the browser benchmark on your device to see first-run overhead
and warmed measurements rather than applying Node numbers to browser playback.

Choose **Weather assistant** for the conversation and live event
inspector. In that view, Run sample streams the fixture through `readStructured`;
Stop passes assistant-ui's AbortSignal to it and the source iterator.

Choose **Complex tools** (`?view=complex`) for three interleaved tool calls:
weather, an hourly forecast with a metric toggle, and a three-day itinerary with
day tabs, fictional stays, and a packing list. Nested points and itinerary items
render from partial parser snapshots; each tool gets a result only after its
complete arguments pass the corresponding Zod schema. The same scenario is
also available in the comparison menu.

All event and weather data is synthetic. No LLM credentials or weather service
are used. The single-stream composer replays the fixture regardless of message text.
Fonts are fetched from Google Fonts; streaming works without them. The weather
background is rendered by the existing widget. It respects reduced motion and
has a static background when animated effects are unavailable. Stay names,
prices, and itinerary suggestions are fictional demonstration data.

## Integration boundary

`src/model.ts` is the actual bridge: `readStructured(events, { integration:
assistantUI, signal, limits: { snapshots: "immutable" } })` produces updates;
the bridge maps them to assistant-ui `tool-call` parts yielded by a
`ChatModelAdapter`. `src/SingleDemo.tsx` passes it to `useLocalRuntime` and renders
`MessagePrimitive.Parts` with a registered weather tool component.

`src/ToolCards.tsx` connects tool parts to the existing UI components.
`src/tool-data.ts` contains the schemas and synthetic results.
Final arguments are validated with Zod before creating the fixture result.
Partial arguments never execute the tool. For a live source, replace the fixture
iterator with decoded assistant-stream events, map tool names/results from the
provider, and handle non-tool message parts separately. The inspector's
Integration tab displays the actual bridge source used by this demo.

`src/parser-runner.ts` implements both parser paths and is shared by live
playback, the browser worker, and the CLI benchmark. `src/comparison.ts`
owns playback, tool validation, and input/timing counters. The
comparison view maps its snapshots into two `useExternalStoreRuntime` instances,
each rendered with the same message components as the single-stream view.
Neither view replaces assistant-ui's internal parser.

```sh
npm test
npm run build
```

With the dev server running, run `npm run test:browser`. Playwright needs its
Chromium installed, or set `CHROME_EXECUTABLE` to an installed Chrome binary.
`DEMO_URL` overrides the default `http://127.0.0.1:4173`; `DEMO_SCREENSHOTS`
overrides the screenshot output directory. Use `npm run dev -- --port 4173`
to match the test default.

The standalone install is intentional: this demo consumes the npm release
instead of a workspace link and adds no React dependencies to Streamfold core.

## Hosting

`vercel.json` configures a standalone Vite build from this directory. Run
`vercel link` to select the demo project, then `vercel deploy --prod` to publish.
No server-side credentials, model service, or database are required.
