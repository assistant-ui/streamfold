import { createChatCompletions } from "./internal/openai-chat-completions.js";

const fields = {
  adapter: "mistral-chat",
  toolCalls: "toolCalls",
  finishReason: "finishReason",
  unwrap: (frame) => frame.data,
  placeholderId: "null",
  getFinalText: (args) =>
    args !== null && typeof args === "object" && !Array.isArray(args)
      ? JSON.stringify(args)
      : undefined,
};

export const mistralChat = (pool, options) => createChatCompletions(pool, options, fields);

export { mistralChat as createStructuredStream };
