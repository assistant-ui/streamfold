import { OpenRouter } from "@openrouter/sdk";
import { readStructured } from "streamfold";
import { openRouter } from "streamfold/openrouter";
import { readToolInputs } from "../examples/openrouter.mjs";

const sdk = new OpenRouter({ apiKey: "typecheck-only" });
const controller = new AbortController();
const chunks = await sdk.chat.send(
  {
    chatRequest: {
      model: "fixture",
      messages: [{ role: "user", content: "Weather?" }],
      stream: true,
      tools: [{ type: "function", function: { name: "weather", parameters: { type: "object" } } }],
    },
  },
  { signal: controller.signal },
);
readStructured(chunks, { integration: openRouter });
readToolInputs(chunks, { signal: controller.signal });
const stream = openRouter();
for await (const chunk of chunks) stream.pushAll(chunk);
