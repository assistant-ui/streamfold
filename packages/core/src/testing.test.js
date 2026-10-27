import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter } from "./index.js";
import { adapterContractTests } from "./testing.js";

for (const batched of [false, true]) {
  const adapter = defineAdapter((event) => event.operations);
  const cases = adapterContractTests({
    adapter,
    encode: (operations) => batched
      ? [{ operations }]
      : operations.map((operation) => ({ operations: [operation] })),
  });
  for (const { name, run } of cases) test(`${batched ? "batch" : "single"} contract: ${name}`, run);
}

test("the kit detects dropped operations, ignored limits, and shared sessions", async () => {
  for (const defect of ["drop", "limits", "shared"]) {
    const factory = defineAdapter((operations) => defect === "drop" ? operations.slice(0, 1) : operations);
    const shared = factory();
    const cases = adapterContractTests({
      adapter: defect === "shared" ? () => shared : defect === "limits" ? () => factory() : factory,
      encode: (operations) => [operations],
    });
    const results = [];
    try {
      for (const entry of cases) {
        try { await entry.run(); results.push(true); }
        catch { results.push(false); }
      }
    } finally { shared.dispose(); }
    assert.ok(results.includes(false), `failed to detect ${defect}`);
  }
});
