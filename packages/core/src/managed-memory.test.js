import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("managed SDK readers release consumed payloads while manual streams retain history", () => {
  const output = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { setImmediate } from "node:timers/promises";
    import { defineAdapter, readStructured } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
    import { vercelAI } from ${JSON.stringify(new URL("./vercel-ai.js", import.meta.url).href)};

    const calls = 200;
    function* events(custom = false) {
      for (let id = 0; id < calls; id++) {
        const text = JSON.stringify({ id, data: ("payload-" + id).repeat(3000) });
        if (custom) {
          yield [{ type: "start", id }, { type: "delta", id, text }, { type: "end", id }];
        } else {
          yield { type: "tool-input-start", id: String(id) };
          yield { type: "tool-input-delta", id: String(id), delta: text };
          yield { type: "tool-input-end", id: String(id) };
        }
      }
    }
    async function consume(custom) {
      const reader = readStructured(events(custom), {
        ...(custom ? { adapter: defineAdapter(event => event) } : { integration: vercelAI }),
        limits: { maxActiveStreams: 1 },
      });
      const references = [];
      while (references.length < calls) {
        const { value } = await reader.next();
        if (value.type === "complete") {
          assert.equal(value.value.id, references.length);
          references.push(new WeakRef(value.value));
        }
      }
      return { reader, references };
    }
    const sdk = await consume(false);
    const custom = await consume(true);
    for (let attempt = 0; attempt < 5; attempt++) {
      await setImmediate();
      global.gc();
    }
    const retained = references => references.filter(ref => ref.deref() !== undefined).length;
    const result = { sdk: retained(sdk.references), custom: retained(custom.references) };
    await sdk.reader.return();
    await custom.reader.return();

    const manual = vercelAI();
    for (const event of events()) manual.pushAll(event);
    assert.deepEqual(manual.finish().map(({ value }) => value.id), Array.from({ length: calls }, (_, id) => id));
    assert.equal(manual.finish().length, calls);
    console.log(JSON.stringify(result));
  `], { encoding: "utf8", timeout: 20_000 });
  const retained = JSON.parse(output);
  assert.ok(retained.custom <= 1, `custom reader retained ${retained.custom} payloads`);
  assert.ok(retained.sdk <= 1, `SDK reader retained ${retained.sdk} payloads`);
});
