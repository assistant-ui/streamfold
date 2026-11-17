import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("retained Anthropic sessions release initial input on failure and managed disposal", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--expose-gc",
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { setImmediate } from "node:timers/promises";
    import { createStructuredStreamPool, readStructured } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
    import { anthropic } from ${JSON.stringify(new URL("./anthropic.js", import.meta.url).href)};

    const heap = async () => {
      for (let n = 0; n < 4; n++) { await setImmediate(); global.gc(); }
      return process.memoryUsage().heapUsed;
    };
    const start = index => ({ type: "content_block_start", index, content_block: {
      type: "tool_use", id: String(index), input: { text: "x".repeat(1024 * 1024) },
    } });
    async function endSession(mode) {
      let stream, pool;
      const reason = new Error("source failed");
      const controller = new AbortController();
      if (["provider", "parser", "limit", "finish"].includes(mode)) {
        pool = createStructuredStreamPool(mode === "limit" ? { maxBytes: 2 } : undefined);
        stream = anthropic(pool);
        for (let index = 0; index < 8; index++) stream.push(start(index));
        let failure;
        try {
          if (mode === "provider") stream.push({ type: "error", error: { message: "provider failed" } });
          if (mode === "parser") stream.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "!" } });
          if (mode === "limit") stream.push({ type: "content_block_stop", index: 0 });
          if (mode === "finish") {
            stream.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{" } });
            stream.finish();
          }
        } catch (error) { failure = error; }
        assert.ok(failure instanceof Error);
        assert.throws(() => stream.finish(), error => error === failure);
      } else {
        let closed = 0;
        async function* events() {
          try {
            for (let index = 0; index < 8; index++) yield start(index);
            if (mode === "source") throw reason;
          } finally { closed++; }
        }
        const reader = readStructured(events(), {
          signal: controller.signal,
          integration(ownedPool, options) {
            pool = ownedPool;
            stream = anthropic(pool, options);
            return stream;
          },
        });
        for (let index = 0; index < 8; index++) assert.equal((await reader.next()).value.type, "start");
        if (mode === "abort") {
          controller.abort(reason);
          await assert.rejects(reader.next(), error => error === reason);
        } else if (mode === "source") await assert.rejects(reader.next(), error => error === reason);
        else await reader.return();
        assert.equal(closed, 1);
      }
      assert.equal(pool.size, 0);
      return stream;
    }
    const retained = [];
    const results = [];
    for (const mode of ["provider", "parser", "limit", "finish", "source", "abort", "return"]) {
      const before = await heap();
      retained.push(await endSession(mode));
      results.push({ mode, retainedBytes: await heap() - before });
    }
    assert.equal(retained.length, 7);
    assert.ok(retained.every(stream => typeof stream.pushAll === "function"));
    console.log(JSON.stringify(results));
  `,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  for (const { mode, retainedBytes } of JSON.parse(output)) {
    assert.ok(retainedBytes < 1024 * 1024, `${mode} retained ${retainedBytes} bytes after cleanup`);
  }
});
