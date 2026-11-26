# Streamfold website

Replay a weather tool call in five fragments. Each step pushes the next string into one scanner from the pinned npm release of Streamfold. The last step calls `finish()`. Reset starts a fresh replay.

The paper Fold in the hero and the two-pane fragment replay below it share one scanner. The install switch copies the command for the selected package manager. The footer links to the integration guide for the pinned release. The GitHub mark is from [Simple Icons 13.0.0](https://github.com/simple-icons/simple-icons/tree/13.0.0), distributed under CC0. Each push seats one facet of the paper plane and updates the figure’s input and output. Step advances a single fragment. Reduced motion draws the same state immediately. Scrolling the figure out of view cancels its flight while the playground remains usable. Switching tabs pauses playback.

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

The browser tests cover keyboard, pointer, touch, and 320px and 390px phone viewports. They check the server-rendered Fold, intermediate motion frames, offscreen cancellation, and live changes to the reduced-motion preference. They also check button target sizes, clipboard contents, denied-copy selection, intermediate JSON, completion, replay, reset, and horizontal overflow. Set `CHROME_EXECUTABLE` to an installed Chrome binary to use it instead. With `CAPTURE_PNG=1`, the tests save initial viewport captures (`desktop.png`, `phone.png`) and completed full-page captures (`desktop-console.png`, `phone-console.png`) in `artifacts/website/` at the repository root.
