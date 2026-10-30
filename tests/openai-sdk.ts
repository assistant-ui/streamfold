import OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { readStructured } from "streamfold";
import { openAI } from "streamfold/openai";

const client = new OpenAI({ apiKey: "typecheck-only" });
const events = await client.responses.create({
  model: "fixture", input: "Weather in Paris?", stream: true,
});
readStructured(events, { integration: openAI });
const stream = openAI();
for await (const event of events) stream.pushAll(event);

declare const event: ResponseStreamEvent;
stream.push(event);
stream.pushAll({ type: "response.future_event", metadata: { source: "provider" } });
