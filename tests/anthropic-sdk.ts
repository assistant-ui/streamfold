import Anthropic from "@anthropic-ai/sdk";
import { readStructured } from "streamfold";
import { anthropic } from "streamfold/anthropic";

const client = new Anthropic({ apiKey: "typecheck-only" });
const request = {
  model: "fixture", max_tokens: 32,
  messages: [{ role: "user" as const, content: "Weather in Paris?" }],
  stream: true as const,
};
const events = await client.messages.create(request);
readStructured(events, { integration: anthropic });
const stream = anthropic();
for await (const event of events) stream.pushAll(event);

const betaEvents = await client.beta.messages.create(request);
readStructured(betaEvents, { integration: anthropic });
const betaStream = anthropic();
for await (const event of betaEvents) betaStream.push(event);
stream.pushAll({ type: "provider_metadata", metadata: { region: "test" } });
