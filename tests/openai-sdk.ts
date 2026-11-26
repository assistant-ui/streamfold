import OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { readStructured } from "streamfold";
import { openAI, openAIChatCompletions, openAIRealtime } from "streamfold/openai";
import { readToolInputs } from "../examples/openai-chat-completions.mjs";

const client = new OpenAI({ apiKey: "typecheck-only" });
const events = await client.responses.create({
  model: "fixture",
  input: "Weather in Paris?",
  stream: true,
});
readStructured(events, { integration: openAI });
const stream = openAI();
for await (const event of events) stream.pushAll(event);

declare const event: ResponseStreamEvent;
stream.push(event);
stream.pushAll({
  type: "response.future_event",
  metadata: { source: "provider" },
});

const chunks = await client.chat.completions.create({
  model: "fixture",
  messages: [{ role: "user", content: "Weather?" }],
  stream: true,
});
readStructured(chunks, { integration: openAIChatCompletions });
readToolInputs(chunks);
const chat = openAIChatCompletions();
for await (const chunk of chunks) chat.pushAll(chunk);

declare const socket: import("openai/realtime/websocket").OpenAIRealtimeWebSocket;
declare const serverEvents: AsyncIterable<import("openai/resources/realtime/realtime").RealtimeServerEvent>;
const realtime = openAIRealtime();
socket.on("event", event => realtime.pushAll(event));
readStructured(serverEvents, { integration: openAIRealtime });
