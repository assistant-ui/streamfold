import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { readStructured } from "streamfold";
import { anthropic } from "streamfold/anthropic";
import { readToolInputs as readResponses } from "./openai.mjs";
import { readToolInputs as readChat } from "./openai-chat-completions.mjs";
import { createProviderClient } from "./openai-compatible.mjs";

const providers = {
  openai: { endpoint: "https://api.openai.com/v1/responses", credential: "OPENAI_API_KEY" },
  anthropic: { endpoint: "https://api.anthropic.com/v1/messages", credential: "ANTHROPIC_API_KEY" },
  groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", credential: "GROQ_API_KEY" },
  ollama: { endpoint: "http://localhost:11434/v1/chat/completions", credential: null },
};
const timeoutMs = 30_000;
const maxOutputTokens = 256;
const prompt = 'Call weather exactly once with {"city":"Paris"}. Do not answer in text.';
const parameters = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
  additionalProperties: false,
};

class SmokeError extends Error {
  /** @param {string} code @param {string} message @param {number} [exitCode] */
  constructor(code, message, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** @param {string | undefined} provider @returns {asserts provider is keyof typeof providers} */
function checkProvider(provider) {
  if (!provider || !Object.hasOwn(providers, provider)) {
    throw new SmokeError(
      "USAGE",
      "Choose `openai`, `anthropic`, `groq`, or `ollama` and provide a model.",
      2,
    );
  }
}

/** @param {string | undefined} model @returns {asserts model is string} */
function checkModel(model) {
  if (!model?.trim() || model.startsWith("--")) {
    throw new SmokeError("USAGE", "Provide a model that supports streamed function tools.", 2);
  }
}

/** @template Event @param {AsyncIterable<Event>} source @param {(event: Event) => void} observe */
async function* observeEvents(source, observe) {
  for await (const event of source) {
    observe(event);
    yield event;
  }
}

/**
 * One explicit invocation sends one request. The CLI gates this behind --apply.
 * @param {{ provider: keyof typeof providers; model: string; apiKey?: string; signal?: AbortSignal; fetch?: typeof fetch }} options
 */
export async function runSmoke({ provider, model, apiKey, signal: callerSignal, fetch: fetcher }) {
  checkProvider(provider);
  checkModel(model);
  const credential = providers[provider].credential;
  if (credential && !apiKey?.trim()) {
    throw new SmokeError(
      "CREDENTIAL_REQUIRED",
      `Set \`${credential}\` before using \`--apply\`.`,
      2,
    );
  }
  const controller = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  const timer = setTimeout(
    () =>
      controller.abort(
        new SmokeError(
          "TIMEOUT",
          "The smoke exceeded 30 seconds. Check connectivity and model readiness.",
        ),
      ),
    timeoutMs,
  );
  const clientOptions = {
    apiKey: apiKey ?? "",
    maxRetries: 0,
    timeout: timeoutMs,
    logLevel: /** @type {const} */ ("off"),
    ...(fetcher ? { fetch: fetcher } : {}),
  };
  let terminal = false;
  let toolStop = false;
  let partialUpdates = 0;
  let completedInputs = 0;
  try {
    signal.throwIfAborted();
    let updates;
    if (provider === "anthropic") {
      const client = new Anthropic({
        ...clientOptions,
        baseURL: "https://api.anthropic.com",
        authToken: null,
        openTelemetry: false,
      });
      const source = await client.messages.create(
        {
          model,
          max_tokens: maxOutputTokens,
          messages: [{ role: "user", content: prompt }],
          tools: [
            {
              name: "weather",
              description: "Preview weather arguments without executing a tool.",
              input_schema: { ...parameters, type: "object" },
            },
          ],
          tool_choice: { type: "tool", name: "weather" },
          stream: true,
        },
        { signal },
      );
      updates = readStructured(
        observeEvents(source, (event) => {
          if (event.type === "message_delta") toolStop = event.delta.stop_reason === "tool_use";
          if (event.type === "message_stop") terminal = toolStop;
        }),
        { integration: anthropic, signal, limits: { snapshots: "immutable" } },
      );
    } else if (provider === "openai") {
      const client = new OpenAI({ ...clientOptions, baseURL: "https://api.openai.com/v1" });
      const source = await client.responses.create(
        {
          model,
          input: prompt,
          max_output_tokens: maxOutputTokens,
          tools: [
            {
              type: "function",
              name: "weather",
              description: "Preview weather arguments without executing a tool.",
              parameters,
              strict: true,
            },
          ],
          tool_choice: { type: "function", name: "weather" },
          stream: true,
        },
        { signal },
      );
      updates = readResponses(
        observeEvents(source, (event) => {
          if (event.type === "response.completed") terminal = event.response.status === "completed";
        }),
        { signal },
      );
    } else {
      const client = createProviderClient(provider, {
        apiKey: apiKey ?? "",
        ...(fetcher ? { fetch: fetcher } : {}),
      }).withOptions({ maxRetries: 0, timeout: timeoutMs, logLevel: "off" });
      const source = await client.chat.completions.create(
        {
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxOutputTokens,
          tools: [
            {
              type: "function",
              function: {
                name: "weather",
                description: "Preview weather arguments without executing a tool.",
                parameters,
              },
            },
          ],
          stream: true,
        },
        { signal },
      );
      updates = readChat(
        observeEvents(source, (event) => {
          if (event.choices[0]?.finish_reason === "tool_calls") terminal = true;
        }),
        { signal },
      );
    }
    for await (const update of updates) {
      if (update.type === "update") partialUpdates++;
      if (update.type !== "complete") continue;
      const value = update.value;
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== 1 ||
        !("city" in value) ||
        value.city !== "Paris"
      ) {
        throw new SmokeError(
          "UNEXPECTED_INPUT",
          "The tool input did not match the smoke fixture. Check model tool support.",
        );
      }
      completedInputs++;
    }
    if (!terminal || completedInputs !== 1)
      throw new SmokeError(
        "INCOMPLETE_SMOKE",
        "Expected one completed tool input and a successful terminal event. Check model tool support and output limits.",
      );
    return { schemaVersion: 1, mode: "passed", provider, model, completedInputs, partialUpdates };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function main() {
  const [provider, model, mode, extra] = process.argv.slice(2);
  checkProvider(provider);
  checkModel(model);
  if (extra || (mode !== undefined && mode !== "--plan" && mode !== "--apply")) {
    throw new SmokeError(
      "USAGE",
      "Usage: node examples/live-smoke.mjs <provider> <model> [--plan|--apply].",
      2,
    );
  }
  const apply = mode === "--apply";
  const plan = {
    schemaVersion: 1,
    mode: "plan",
    provider,
    model,
    ...providers[provider],
    prompt,
    expectedInput: { city: "Paris" },
    requests: 1,
    maxOutputTokens,
    timeoutMs,
    retries: 0,
    apply,
  };
  console.log(JSON.stringify(plan));
  if (!apply) return;
  if (process.env.CI)
    throw new SmokeError(
      "MANUAL_ONLY",
      "Live smoke checks are manual. Run outside CI with `--apply`.",
      3,
    );
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    const credential = providers[provider].credential;
    console.log(
      JSON.stringify(
        await runSmoke({
          provider,
          model,
          apiKey: credential ? (process.env[credential] ?? "") : "",
          signal: controller.signal,
        }),
      ),
    );
  } finally {
    process.off("SIGINT", cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safe =
      error instanceof SmokeError
        ? error
        : new SmokeError(
            "SMOKE_FAILED",
            "Provider smoke failed. Check credentials, model tool support, output limits, and connectivity.",
          );
    console.error(`${safe.code}: ${safe.message}`);
    process.exitCode = safe.exitCode;
  });
}
