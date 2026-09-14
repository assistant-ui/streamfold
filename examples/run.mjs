import { readToolInputs as assistantUI } from "./assistant-ui.mjs";
import { readToolInputs as vercelAI } from "./vercel-ai.mjs";
import { readToolInputs as custom } from "./custom.mjs";

for (const [name, read] of Object.entries({ assistantUI, vercelAI, custom })) {
  console.log(`\n${name}`);
  for await (const update of read()) {
    console.log(update.type, update.id, JSON.stringify(update.partialValue));
    if (update.type === "complete") console.log("Final arguments:", update.value);
  }
}

const controller = new AbortController();
try {
  for await (const update of custom(undefined, { signal: controller.signal })) {
    console.log("Stopping after:", update.type);
    controller.abort();
  }
} catch (error) {
  if (error !== controller.signal.reason) throw error;
  console.log("Cancelled; incomplete arguments were not finalized.");
}
