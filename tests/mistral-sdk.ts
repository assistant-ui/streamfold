import { Mistral } from "@mistralai/mistralai";
import { readStructured } from "streamfold";
import { createStructuredStream as createChatStream, mistralChat } from "streamfold/mistral";
import { readToolInputs as readChatInputs } from "../examples/mistral-chat.mjs";
import { readToolInputs } from "../examples/mistral.mjs";

const client = new Mistral({ apiKey: "typecheck-only" });
const controller = new AbortController();
const source = await client.responses.create(
  { model: "test-model", input: "Weather?", stream: true },
  { signal: controller.signal },
);
for await (const update of readToolInputs(source, { signal: controller.signal })) {
  const id: string = update.id;
  void id;
}

const chat = await client.chat.stream(
  {
    model: "test-model",
    messages: [{ role: "user", content: "Weather?" }],
  },
  { signal: controller.signal },
);
readStructured(chat, { integration: mistralChat });
readChatInputs(chat);
const adapter = createChatStream();
for await (const event of chat) adapter.pushAll(event);
// @ts-expect-error The Responses API yields a different frame type.
readStructured(source, { integration: mistralChat });
