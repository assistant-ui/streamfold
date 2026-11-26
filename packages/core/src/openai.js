import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";
import { acceptOpenAIResponse } from "./internal/openai-responses.js";

export const openAI = (pool = createStructuredStreamPool(), options) =>
  createIntegration(pool, acceptOpenAIResponse, undefined, "openai", options);

export { openAI as createStructuredStream };

export { openAIChatCompletions } from "./internal/openai-chat-completions.js";
export { openAIRealtime } from "./internal/openai-realtime.js";
