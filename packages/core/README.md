# streamfold

Incremental structured state for streamed AI tool calls.

Streamfold retains JSON parser and value state across deltas. Its embedded
Rust/WebAssembly engine emits compact patches and works in Node.js 20+ and
modern browsers without native build tools or provider SDK dependencies.

## Install

```bash
npm install streamfold
```

## Quick start

```ts
import { createStructuredStream } from "streamfold";

const stream = createStructuredStream();
const update = stream.push('{"city":"San');

console.log(update.partialValue); // { city: "San" }

stream.push(' Francisco"}');
console.log(stream.getFieldState(["city"])); // "complete"

stream.finish();
stream.dispose();
```

Use `streamfold/assistant-ui`, `streamfold/vercel-ai`, `streamfold/openai`,
`streamfold/anthropic`, `streamfold/gemini`, `streamfold/langchain`, or
`streamfold/ag-ui` for decoded SDK events. Integrations use structural event
types and do not load provider SDKs.

See the repository for the [API reference](https://github.com/assistant-ui/streamfold/blob/main/API.md),
[integration guide](https://github.com/assistant-ui/streamfold/blob/main/MIGRATION.md),
and [benchmarks](https://github.com/assistant-ui/streamfold#performance).

MIT © Streamfold contributors
