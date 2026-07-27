# streamfold

Protocol-neutral incremental state for structured AI streams.

The parser runs in Rust through an embedded WebAssembly module. Consumers do not
need Rust installed and the package has no provider SDK dependencies.

```bash
pnpm add streamfold
```

Use an integration-specific entry point:

```ts
import { createStructuredStream } from "streamfold/assistant-ui";

const stream = createStructuredStream();

for await (const event of assistantStream) {
  const update = stream.push(event);
  if (update && "value" in update) {
    console.log(update.id, update.value);
  }
}
```

Or compose an integration with the core factory:

```ts
import { createStructuredStream } from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";

const stream = createStructuredStream(assistantUI);
```

Available subpaths are `assistant-ui`, `vercel-ai`, `openai`, `anthropic`,
`gemini`, `langchain`, and `ag-ui`. None imports a provider SDK.

Streamfold is currently a benchmark-backed prototype. It retains structural
state and materializes the final value once; it does not yet provide a
renderable partial value after every delta.

See the [repository README](https://github.com/assistant-ui/streamfold#readme)
for benchmarks, methodology, and development instructions.
