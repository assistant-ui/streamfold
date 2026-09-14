import assert from "node:assert/strict";
import test from "node:test";
import { adapterContractTests } from "streamfold/testing";
import { readToolInputs as assistantUI } from "./assistant-ui.mjs";
import { readToolInputs as vercelAI } from "./vercel-ai.mjs";
import { readToolInputs as custom, weatherAdapter } from "./custom.mjs";

for (const [name, read] of Object.entries({ assistantUI, vercelAI, custom })) {
  test(`${name} example streams stable partial values and one final result`, async () => {
    const updates = [];
    for await (const update of read()) updates.push(update);
    assert.deepEqual(updates.map(({ type }) => type), ["start", "update", "update", "complete"]);
    assert.deepEqual(updates[1].partialValue, { city: "San" });
    assert.deepEqual(updates.at(-1).value, { city: "San Francisco" });
    assert.ok(Object.isFrozen(updates[1].partialValue));
  });
  test(`${name} example supports stop without finalizing`, async () => {
    const controller = new AbortController();
    const source = read(undefined, { signal: controller.signal });
    assert.equal((await source.next()).value.type, "start");
    controller.abort();
    await assert.rejects(source.next(), { name: "AbortError" });
  });
}

for (const { name, run } of adapterContractTests({
  adapter: weatherAdapter,
  encode: (operations) => operations.map((operation) => {
    switch (operation.type) {
      case "start": return { kind: "begin", id: operation.id };
      case "delta": return { kind: "piece", id: operation.id, text: operation.text };
      case "end": return { kind: "done", id: operation.id };
      case "abort": return { kind: "cancel", id: operation.id };
    }
  }),
})) test(`custom weather protocol: ${name}`, run);

test("custom example rejects malformed protocol events", () => {
  const session = weatherAdapter();
  try { assert.throws(() => session.pushAll({ kind: "unexpected", id: "a" }), TypeError); }
  finally { session.dispose(); }
});
