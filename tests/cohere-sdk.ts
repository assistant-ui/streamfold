import { CohereClientV2 } from "cohere-ai";
import { readStructured } from "streamfold";
import { cohere } from "streamfold/cohere";

const client = new CohereClientV2({ token: "typecheck-only" });
const events = await client.chatStream({ model: "command-a", messages: [{ role: "user", content: "Weather?" }] });
readStructured(events, { integration: cohere });
const stream = cohere();
for await (const event of events) stream.pushAll(event);
