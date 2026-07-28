# streamfold

Incremental structured state for streamed AI tool calls.

Streamfold retains JSON parser and value state across deltas. Its Rust/WebAssembly
engine emits compact patches that update a live partial JavaScript value without
reparsing the complete accumulated input.

## Installation

Streamfold is ESM-only and supports Node.js 20 or newer and modern browsers.
The Rust/WebAssembly engine is bundled, so no Rust toolchain, native build
tools, or provider SDK dependencies are required.

```bash
# npm
npm install streamfold

# pnpm
pnpm add streamfold

# Yarn
yarn add streamfold

# Bun
bun add streamfold
```

## Quick start

```ts
import { createStructuredStream } from "streamfold";

const stream = createStructuredStream();
const update = stream.push('{"city":"San');

console.log(update.partialValue); // { city: "San" }
console.log(update.changes); // compact set/append/complete patches

stream.push(' Francisco"}');
console.log(stream.getFieldState(["city"])); // "complete"
```

Resource limits are configurable and enabled by default:

```ts
const stream = createStructuredStream({
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 64,
});
```

Use an isolated event integration when consuming an SDK stream:

```ts
import { createStructuredStream } from "streamfold/assistant-ui";

const toolCalls = createStructuredStream();

for await (const event of assistantStream) {
  const update = toolCalls.push(event);
  if (update) renderToolInput(update.id, update.partialValue);
}
```

Available subpaths are `assistant-ui`, `vercel-ai`, `openai`, `anthropic`,
`gemini`, `langchain`, and `ag-ui`. They consume structural event shapes and do
not install or load provider SDKs.

See the [repository README](https://github.com/assistant-ui/streamfold#readme)
for benchmarks, methodology, and development instructions. The
[migration guide](https://github.com/assistant-ui/streamfold/blob/main/MIGRATION.md)
covers direct streams and every bundled integration.
