import { createChatCompletions } from "./internal/openai-chat-completions.js";

const fields = {
  adapter: "openrouter",
  toolCalls: "toolCalls",
  finishReason: "finishReason",
};

export const openRouter = (pool, options) => createChatCompletions(pool, options, fields);

export { openRouter as createStructuredStream };
