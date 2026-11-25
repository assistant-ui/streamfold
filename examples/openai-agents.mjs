import { pathToFileURL } from "node:url";
import { Agent, Runner, tool } from "@openai/agents";
import { z } from "zod";
import { readStructured } from "streamfold";
import { openAIAgents } from "streamfold/openai-agents";

/**
 * @param {string | import("@openai/agents").Model} model
 * @param {AbortSignal} signal
 * @param {(update: import("streamfold").StructuredStreamLifecycleUpdate<string>) => void} onUpdate
 */
export async function previewWeather(model, signal, onUpdate) {
  const weather = tool({
    name: "weather",
    description: "Return the example forecast for a city.",
    parameters: z.object({ city: z.string() }),
    execute: ({ city }) => `Sunny in ${city}`,
  });
  const agent = new Agent({
    name: "Weather",
    model,
    tools: [weather],
    modelSettings: { toolChoice: "required" },
    toolUseBehavior: "stop_on_first_tool",
  });
  const runner = new Runner({ tracingDisabled: true });
  const run = await runner.run(agent, "Weather in Paris?", { stream: true, signal });
  for await (const update of readStructured(run, {
    integration: openAIAgents,
    limits: { snapshots: "immutable" },
    signal,
  }))
    onUpdate(update);
  await run.completed;
  return run.finalOutput;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const model = process.env.OPENAI_MODEL;
  if (!model) throw new Error("Set `OPENAI_MODEL` to a model that supports function tools.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    console.log(
      await previewWeather(model, controller.signal, (update) => {
        console.log(update.type, update.id, update.partialValue);
      }),
    );
  } finally {
    process.off("SIGINT", cancel);
  }
}
