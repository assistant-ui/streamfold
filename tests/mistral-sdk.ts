import { Mistral } from "@mistralai/mistralai";
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
