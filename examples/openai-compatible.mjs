import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { readToolInputs } from "./openai-chat-completions.mjs";

export class ProviderConfigurationError extends Error {
  name = "ProviderConfigurationError";
  code = "PROVIDER_CONFIGURATION";
}

/**
 * @param {"ollama" | "groq"} provider
 * @param {{ apiKey?: string; fetch?: typeof fetch }} [options]
 */
export function createProviderClient(provider, options = {}) {
  if (provider !== "ollama" && provider !== "groq") {
    throw new Error("Choose `ollama` or `groq`.");
  }
  if (provider === "groq" && !options.apiKey?.trim()) {
    throw new Error("Set `GROQ_API_KEY` before running the Groq example.");
  }
  if (process.env.OPENAI_CUSTOM_HEADERS?.trim()) {
    throw new ProviderConfigurationError(
      "Unset `OPENAI_CUSTOM_HEADERS` before running a compatible-provider example.",
    );
  }
  return new OpenAI({
    adminAPIKey: null,
    organization: null,
    project: null,
    baseURL:
      provider === "ollama"
        ? "http://localhost:11434/v1"
        : "https://api.groq.com/openai/v1",
    apiKey: provider === "ollama" ? "ollama" : options.apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

/**
 * @param {OpenAI} client The application's configured client.
 * @param {string} model A model that supports streaming function tools.
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function* streamWeather(client, model, options = {}) {
  if (!model.trim())
    throw new Error("Provide a model that supports streaming function tools.");
  const source = await client.chat.completions.create(
    {
      model,
      messages: [
        {
          role: "user",
          content: "What is the weather in Paris and Addis Ababa?",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            description: "Get the weather for a city.",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
              additionalProperties: false,
            },
          },
        },
      ],
      stream: true,
    },
    options,
  );
  yield* readToolInputs(source, options);
}

async function main() {
  const [provider, model, extra] = process.argv.slice(2);
  if ((provider !== "ollama" && provider !== "groq") || !model || extra) {
    console.error(
      "Usage: node examples/openai-compatible.mjs <ollama|groq> <model>",
    );
    process.exitCode = 2;
    return;
  }
  const client = createProviderClient(
    provider,
    provider === "groq" ? { apiKey: process.env.GROQ_API_KEY ?? "" } : {},
  );
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  try {
    for await (const update of streamWeather(client, model, {
      signal: controller.signal,
    })) {
      console.log(
        JSON.stringify({
          type: update.type,
          id: update.id,
          value: update.partialValue,
        }),
      );
    }
  } finally {
    process.removeListener("SIGINT", abort);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
