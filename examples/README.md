# Runnable integrations

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm examples
node --test examples/integrations.test.mjs
```

The commands above replay decoded event fixtures, not live model requests. They
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

Each reader in the table accepts a synchronous or
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

## OpenAI Responses

[`openai.mjs`](./openai.mjs) makes a live OpenAI Responses request and prints
immutable tool-argument previews followed by completed JSON values. It does not
execute the requested tool. From the repository root, set `OPENAI_API_KEY` and
`OPENAI_MODEL` in your environment, then run:

```bash
node examples/openai.mjs
```

Choose a Responses API model that supports function calling. The example forces
the `weather` function so the request produces tool arguments. Press Ctrl+C to
abort; the same signal reaches the SDK request and Streamfold's reader.

To reuse the reader, copy `openai.mjs` alongside your application and install
`openai` and `streamfold`. Importing it makes no request:

```js
import OpenAI from "openai";
import { readToolInputs } from "./openai.mjs";

const client = new OpenAI();
const controller = new AbortController();
const events = await client.responses.create({
  model: process.env.OPENAI_MODEL,
  input: "What is the weather in Paris?",
  tools, // Use your application's function definitions.
  stream: true,
}, { signal: controller.signal });

for await (const update of readToolInputs(events, { signal: controller.signal })) {
  console.log(update.id, update.partialValue);
  if (update.type === "complete") console.log("Final arguments:", update.value);
}
```

`update.id` is the output item ID, not the function's `call_id`. Keep the mapping
to `call_id` in your application's existing response handler if you send tool
results back. Consume the SDK stream once; wrap that same event loop if you also
need text, tool names, or response metadata. The reader ignores non-tool output,
surfaces failed and terminal incomplete responses, and cancels its SDK iterator
on failure or early exit. A complete value has passed JSON parsing; validate its
schema and authorize any tool execution in your application.

Run `node --test examples/openai.test.mjs` without credentials for fragmented SSE
decoding, concurrent calls, immutable previews, final arguments, errors,
cancellation, and the executable against a local HTTP fixture. `pnpm typecheck`
checks the example against `openai@7.47.0`. These checks do not make live model
requests or establish a performance improvement. The example uses the public
`streamfold/openai` adapter; it does not replace the SDK's own parser.

## OpenAI Chat Completions

[`openai-chat-completions.mjs`](./openai-chat-completions.mjs) reads function tool
arguments from `client.chat.completions.create()`. It requires the **unreleased**
`openAIChatCompletions` export; Streamfold 0.1.19 does not include it. From this
checkout, run `node --test examples/openai-chat-completions.test.mjs` for the
credential-free example through the real OpenAI SDK and a local HTTP server.

For your own request, supply a model supporting Chat Completions function tools:

```js
import OpenAI from "openai";
import { readToolInputs } from "./openai-chat-completions.mjs";

const client = new OpenAI();
const controller = new AbortController();
const chunks = await client.chat.completions.create({
  model: process.env.OPENAI_MODEL,
  messages: [{ role: "user", content: "Weather in Paris?" }],
  tools: [{
    type: "function",
    function: {
      name: "weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
        additionalProperties: false,
      },
    },
  }],
  stream: true,
}, { signal: controller.signal });

for await (const update of readToolInputs(chunks, { signal: controller.signal })) {
  console.log(update.id, update.partialValue);
}
```

Set `OPENAI_API_KEY` and `OPENAI_MODEL` in your application's environment. The
example never executes tools. Validate completed arguments against your schema
before execution. It ignores text, usage, and non-function tools; successful
choice endings complete arguments, while truncation, provider errors, malformed
JSON, or unfinished EOF fail the reader. Pass the same signal to the SDK and
reader to cancel pending network reads. Tests cover OpenAI SDK 7.47.0, local
SSE decoding, interleaved tools, immutable previews, cancellation, and failures.
They do not call a live provider or establish a performance improvement.

Protocol reference: [OpenAI Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).

## Ollama and Groq

[`openai-compatible.mjs`](./openai-compatible.mjs) makes a streaming weather-tool
request with the OpenAI client and the same Chat Completions reader above. This
also requires the **unreleased** adapter from PR #165, not npm 0.1.19.

```bash
# Use an already installed Ollama model that supports streaming function tools.
node examples/openai-compatible.mjs ollama "$OLLAMA_MODEL"

# Set GROQ_API_KEY and choose a Groq model with streaming function-tool support.
node examples/openai-compatible.mjs groq "$GROQ_MODEL"

# Credential-free protocol verification:
node --test examples/openai-compatible.test.mjs
```

The Ollama command uses `http://localhost:11434/v1` with the placeholder key
`ollama`. It requires your local server to be running and does not download a
model. The Groq command uses `https://api.groq.com/openai/v1` and requires
`GROQ_API_KEY`; it never falls back to `OPENAI_API_KEY`. Model names are explicit
because availability and tool support vary. Both commands print argument
updates, never execute tools, and cancel on Ctrl+C.

For an existing application, pass your own configured OpenAI client:

```js
import { streamWeather } from "./openai-compatible.mjs";

for await (const update of streamWeather(client, model, { signal })) {
  renderInput(update.id, update.partialValue);
}
```

The tests use **synthetic protocol fixtures**, not captured provider responses:
whole-argument tool chunks with a `tool_calls` ending for Ollama, and interleaved
argument fragments with a `tool_calls` ending and usage metadata for Groq.
Both run through OpenAI SDK 7.47.0's real SSE decoder and verify request routing,
immutable values, failed endings, provider errors, early return, and abort.
The Ollama shape follows its [OpenAI conversion code](https://github.com/ollama/ollama/blob/508d8be9c8a43d6b9f98d6abca099f51320bff2b/openai/openai.go).
No live Ollama or Groq model was tested. This establishes example wiring and
fixture compatibility, not compatibility with every model or provider version.
Ollama's native `/api/chat` object arguments are outside this example's scope.

Provider references: [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility),
[Groq OpenAI compatibility](https://console.groq.com/docs/openai), and
[Groq local tool calling](https://console.groq.com/docs/tool-use/local-tool-calling).

## Mistral Responses

[`mistral.mjs`](./mistral.mjs) accepts the asynchronous stream returned by
`@mistralai/mistralai`'s Responses API. Copy it into your application alongside
the SDK and `streamfold`. It reuses `streamfold/openai`: Mistral emits compatible
tool-argument events, but the SDK wraps them in `frame.data` and converts
`item_id` to `itemId`. The example normalizes those differences before parsing.

```js
import { Mistral } from "@mistralai/mistralai";
import { readToolInputs } from "./mistral.mjs";

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const controller = new AbortController();
const events = await client.responses.create({
  model: process.env.MISTRAL_MODEL,
  input: "What is the weather in Paris?",
  tools: [{
    type: "function",
    name: "weather",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
  }],
  stream: true,
}, { signal: controller.signal });

for await (const update of readToolInputs(events, { signal: controller.signal })) {
  console.log(update.id, update.partialValue);
}
```

Set `MISTRAL_MODEL` to a model supported by the
[Mistral Responses API](https://docs.mistral.ai/studio/conversations/responses).
The example yields immutable tool-argument previews keyed by output item ID,
not `callId`. It does not execute tools, validate their schema, or interpret
response-level status events. Keep those responsibilities in the application's
existing response handler. Breaking the loop closes the SDK iterator; pass the
same signal to both calls to also cancel pending network reads.

Run `node --test examples/mistral.test.mjs` for a credential-free check through
the real SDK's SSE decoder. `pnpm typecheck` also checks an actual
`client.responses.create()` stream against this example. These checks use
`@mistralai/mistralai@3.4.0`; they do not make live model requests or establish
an end-to-end performance improvement.

## Interactive assistant-ui demo

The [standalone React demo](./assistant-ui-demo/README.md) consumes the published
Streamfold package through real assistant-ui runtime and tool-rendering
primitives and the existing WeatherWidget, Chart, Timeline, and DataTable UI.
It includes a with/without comparison, a complex trip planner, a live event
inspector, cancellation, concurrent tool calls, and malformed-JSON handling.
All model events and weather data are
fixtures; no API key is required.
