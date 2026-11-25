import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";
import { createChatCompletionsHandler } from "./internal/openai-chat-completions.js";
import { acceptOpenAIResponse } from "./internal/openai-responses.js";

export const openAIAgents = (pool = createStructuredStreamPool(), options) => {
  const chat = createChatCompletionsHandler();
  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type !== "raw_model_stream_event") return;
      const { data, source } = event;
      if (data.type === "response_done") {
        chat.finish();
        let update;
        for (const id of pool.activeIds) update = calls.complete(id);
        return update;
      }
      if (data.type !== "model") return;
      if (source === "openai-chat-completions") return chat.accept(data.event, calls);
      if (source === "openai-responses") return acceptOpenAIResponse(data.event, calls);
    },
    chat.finish,
    "openai-agents",
    options,
    chat.clear,
  );
};

export { openAIAgents as createStructuredStream };
