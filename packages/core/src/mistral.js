import { createStructuredStreamPool } from "./index.js";
import { createChatCompletions } from "./internal/openai-chat-completions.js";

const normalize = ({ data }) => ({
  choices: data.choices.map(({ index, finishReason, delta }) => ({
    index,
    finish_reason: finishReason,
    delta: {
      tool_calls: delta.toolCalls?.map((tool) => ({
        index: tool.index,
        id: tool.id === "null" ? undefined : tool.id,
        type: tool.type,
        function: tool.function,
      })),
    },
  })),
});

const getFinalText = (args) =>
  args !== null && typeof args === "object" && !Array.isArray(args)
    ? JSON.stringify(args)
    : undefined;

export const mistralChat = (pool = createStructuredStreamPool(), options) =>
  createChatCompletions(pool, options, "mistral-chat", normalize, getFinalText);

export { mistralChat as createStructuredStream };
