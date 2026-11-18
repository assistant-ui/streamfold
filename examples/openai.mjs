import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { readStructured } from "streamfold";
import { openAI } from "streamfold/openai";

/**
 * @param {AsyncIterable<import('openai/resources/responses/responses').ResponseStreamEvent>} source
 * @param {{ signal?: AbortSignal }} [options]
 */
export function readToolInputs(source, options = {}) {
  return readStructured(source, {
    integration: openAI,
    limits: { snapshots: "immutable" },
    ...options,
  });
}

async function main() {
  const model = process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error("Set `OPENAI_MODEL` to a Responses API model that supports function calling.");
  }
  const client = new OpenAI();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    const events = await client.responses.create(
      {
        model,
        input: "What is the weather in Paris?",
        tools: [
          {
            type: "function",
            name: "weather",
            description: "Look up the weather in a city.",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
              additionalProperties: false,
            },
            strict: true,
          },
        ],
        tool_choice: { type: "function", name: "weather" },
        stream: true,
      },
      { signal: controller.signal },
    );

    for await (const update of readToolInputs(events, { signal: controller.signal })) {
      console.log(
        JSON.stringify({
          type: update.type,
          id: update.id,
          value: update.type === "complete" ? update.value : update.partialValue,
        }),
      );
    }
  } finally {
    process.off("SIGINT", cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
