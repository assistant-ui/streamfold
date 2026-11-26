# Streamfold website

Replay the same five weather tool-call fragments through a buffered `JSON.parse` and the published Streamfold scanner. The simulated arrival clock starts at 0.0 s and advances 0.8 s per fragment. The buffered path parses once after the final fragment. Streamfold calls `push()` on every fragment and `finish()` on the last. The displayed milestone records when each output first contains a nonempty `city` string. The 2.4 s lead measures availability on this schedule, independent of parsing speed or wall-clock pauses.

The install switch copies the command for the selected package manager. Use Step to inspect one partial value or Play to run the replay. Switching tabs pauses playback. The footer links to the integration guide for the pinned release. The GitHub mark is from [Simple Icons 13.0.0](https://github.com/simple-icons/simple-icons/tree/13.0.0), distributed under CC0.

## Local production preview

Use Node 24 and pnpm 11.10.0. From the repository root:

```sh
cd website
pnpm install --frozen-lockfile
pnpm build
HOST=127.0.0.1 PORT=4317 pnpm preview
```

Open <http://127.0.0.1:4317>. Stop the server with Ctrl+C. The [Farm.js](https://farmjs.dev/docs/getting-started) build writes a Node server to `.farm/.output` and generates route types before TypeScript checks the site.

The app has its own lockfile and uses the repository's 24-hour minimum release age and provenance downgrade protection. Farm CLI and core are pinned to 0.1.81 because its tunnel dependency passes those checks.

## Verify the replay

With the production preview running, use a second terminal from the repository root:

```sh
cd website
pnpm exec playwright install chromium
CAPTURE_PNG=1 pnpm test:browser
```

The browser tests exercise keyboard and touch controls at 1440px, 390px and 320px. They check control size, focus, clipboard contents, denied-copy selection, intermediate JSON, completion, replay, reset and horizontal overflow. Set `CHROME_EXECUTABLE` to an installed Chrome binary to use it instead. With `CAPTURE_PNG=1`, the tests save midway and completed comparisons (full page on desktop, replay section on phones) in `artifacts/website/` (for example, `phone-midway.png` and `desktop-complete.png`).
