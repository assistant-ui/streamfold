import { chat } from "@tanstack/ai";
import { fixtureAdapter, weatherChat } from "./fixture.mjs";
import { readToolInputs } from "./read-tool-inputs.mjs";

const abortController = new AbortController();
const events = chat({ ...weatherChat, adapter: fixtureAdapter(), abortController });
for await (const update of readToolInputs(events, abortController)) {
  if (update.type === "update") console.log(update.id, "partial", update.partialValue);
  if (update.type === "complete") console.log(update.id, "final", update.value);
}
