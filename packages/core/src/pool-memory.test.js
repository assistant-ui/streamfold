import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("empty deltas do not retain input storage in an active pool", () => {
  const output = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createStructuredStreamPool } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
    const results = [];
    for (const snapshots of ["live", "immutable"]) {
      const pool = createStructuredStreamPool({ maxBytes: 2, snapshots });
      pool.start("a", "{");
      for (let i = 0; i < 1000; i++) pool.push("a", "");
      const heap = () => {
        for (let i = 0; i < 4; i++) global.gc();
        return process.memoryUsage().heapUsed;
      };
      const before = heap();
      let state;
      for (let i = 0; i < 500000; i++) state = pool.push("a", "");
      const retainedBytes = heap() - before;
      assert.equal(state.bytesSeen, 1);
      assert.deepEqual(state.partialValue, {});
      assert.deepEqual(state.changes, []);
      pool.push("a", "}");
      const result = pool.finish("a");
      assert.equal(result.text, "{}");
      assert.deepEqual(result.value, {});
      assert.equal(pool.size, 0);
      results.push({ snapshots, retainedBytes });
    }
    console.log(JSON.stringify(results));
  `], { encoding: "utf8", timeout: 20_000 });
  for (const { snapshots, retainedBytes } of JSON.parse(output)) {
    assert.ok(retainedBytes < 1024 * 1024,
      `${snapshots}: empty deltas retained ${retainedBytes} bytes without adding input`);
  }
});
