import { Agent, Runner } from "@openai/agents";
import { readStructured } from "streamfold";
import { createStructuredStream, openAIAgents } from "streamfold/openai-agents";

const run = await new Runner({ tracingDisabled: true }).run(
  new Agent({ name: "Weather" }),
  "Weather?",
  { stream: true },
);
readStructured(run, { integration: openAIAgents });
const stream = createStructuredStream();
for await (const event of run) stream.pushAll(event);
await run.completed;
