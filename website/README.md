# Streamfold website

Replay a weather tool call in five fragments. Each step pushes the next string into one scanner from the pinned npm release of Streamfold. The last step calls `finish()`. Reset starts a fresh replay.

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

The test drives desktop keyboard controls and a touch-enabled phone viewport. It checks clipboard contents, intermediate JSON, completion, replay, reset, and horizontal overflow. Set `CHROME_EXECUTABLE` to an installed Chrome binary to use it instead. With `CAPTURE_PNG=1`, the tests save full-page captures to `artifacts/website/{desktop,phone}.png` at the repository root.
