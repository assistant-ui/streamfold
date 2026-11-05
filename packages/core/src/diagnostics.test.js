import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const callbacks = {
  "async rejection": "async () => { await Promise.resolve(); throw new Error('logger failed'); }",
  "rejecting thenable":
    "() => ({ then(_resolve, reject) { reject(new Error('logger failed')); } })",
  "throwing then getter": "() => ({ get then() { throw new Error('logger failed'); } })",
  "pending promise": "() => new Promise(() => {})",
};

for (const [name, callback] of Object.entries(callbacks)) {
  test(`diagnostic ${name} cannot escape parsing or delay cleanup`, () => {
    const source = `
      import assert from "node:assert/strict";
      import { createStructuredStreamPool } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
      import { vercelAI } from ${JSON.stringify(new URL("./vercel-ai.js", import.meta.url).href)};
      const onDiagnostic = ${callback};
      const success = vercelAI(undefined, { onDiagnostic });
      success.pushAll({ type: "tool-input-delta" });
      success.pushAll({ type: "tool-input-start", id: "done" });
      success.pushAll({ type: "tool-input-delta", id: "done", delta: '{"ok":true}' });
      assert.deepEqual(success.finish().map(({ value }) => value), [{ ok: true }]);

      const pool = createStructuredStreamPool();
      const failed = vercelAI(pool, { onDiagnostic });
      failed.pushAll({ type: "tool-input-start", id: "pending" });
      failed.pushAll({ type: "tool-input-delta", id: "pending", delta: "{" });
      const failure = new Error("upstream failed");
      assert.throws(() => failed.pushAll({ type: "error", error: failure }), error => error === failure);
      assert.equal(pool.size, 0);
      assert.throws(() => failed.finish(), error => error === failure);
      await new Promise(resolve => setImmediate(resolve));
      console.log("completed");
    `;
    const result = spawnSync(
      process.execPath,
      ["--unhandled-rejections=strict", "--input-type=module", "--eval", source],
      { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "completed");
  });
}
