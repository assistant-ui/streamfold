import { createOpenaiChatCompletions } from "@tanstack/ai-openai";

const model = "gpt-4o";
export function call(index, id, args) {
  return {
    tool_calls: [
      {
        index,
        ...(id && { id, type: "function" }),
        function: { ...(id && { name: "weather" }), arguments: args },
      },
    ],
  };
}

export function frame(delta, finishReason = null) {
  const chunk = {
    id: "chat-fixture",
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function sse(body) {
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function weatherResponse() {
  return sse(
    [
      frame(call(0, "west", '{"city":"San')),
      frame(call(1, "east", '{"city":"New')),
      frame(call(0, null, ' Francisco"}')),
      frame(call(1, null, ' York"}')),
      frame({}, "tool_calls"),
      "data: [DONE]\n\n",
    ].join(""),
  );
}

export function fixtureAdapter(fetch = weatherResponse) {
  return createOpenaiChatCompletions(model, "offline", {
    baseURL: "https://fixture.invalid/v1",
    fetch,
    maxRetries: 0,
  });
}

export const weatherChat = {
  threadId: "weather-example",
  messages: [{ role: "user", content: "Compare the weather in San Francisco and New York." }],
  tools: [
    {
      name: "weather",
      description: "Look up the weather in a city.",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
        additionalProperties: false,
      },
    },
  ],
};
