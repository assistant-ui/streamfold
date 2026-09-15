# Runnable integrations

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm examples
node --test examples/integrations.test.mjs
```

These examples replay decoded event fixtures, not live model requests. They
require no API keys and use public `streamfold` imports. The assistant-ui and
Vercel fixtures are typechecked against the development SDK versions in this
repository. Runtime adapters do not import either SDK.

| File | Input |
| --- | --- |
| `assistant-ui.mjs` | assistant-stream `AssistantStreamChunk` events |
| `vercel-ai.mjs` | AI SDK `UIMessageChunk` events |
| `custom.mjs` | A custom begin/piece/done/cancel protocol |
| `run.mjs` | Runs all three and demonstrates cancellation |
| `integrations.test.mjs` | Examples plus the custom-adapter contract suite |

Each `readToolInputs(source, { signal })` function accepts a synchronous or
asynchronous event source. Replace its default fixture with your already-decoded
stream. Do not pass raw SSE frames or response-body bytes. Do not iterate a
single-use source twice; place parsing in its existing transport/runtime loop.

```js
import { readToolInputs } from "./assistant-ui.mjs";

for await (const update of readToolInputs(decodedEvents, { signal })) {
  updateStore(update.id, update.partialValue);
  if (update.type === "complete") validateArguments(update.value);
}
```

`decodedEvents`, `signal`, `updateStore`, and `validateArguments` above belong to
your application. Partial values use immutable snapshots, so earlier values
stay unchanged. Lifecycle completion means arguments ended, not that a tool ran.
Keep schema validation, authorization, and tool execution in your application.

Managed consumption finalizes pending calls at normal EOF and disposes on early
exit or failure. Pass the same abort signal to your SDK/transport to cancel the
network request too. The explicit signal and testing subpath require Streamfold
0.1.6 or newer; the three normal-consumption examples also work with 0.1.5.

The assistant-ui adapter is an event translator. This example does not replace
assistant-ui's internal parser or claim an end-to-end performance improvement.

## Interactive assistant-ui demo

The [standalone React demo](./assistant-ui-demo/README.md) consumes the published
Streamfold package through real assistant-ui runtime and tool-rendering
primitives and the existing WeatherWidget, Chart, Timeline, and DataTable UI.
It includes a with/without comparison, a complex trip planner, a live event
inspector, cancellation, concurrent tool calls, and malformed-JSON handling.
All model events and weather data are
fixtures; no API key is required.
