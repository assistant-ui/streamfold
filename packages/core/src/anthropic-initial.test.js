import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { anthropic } from "./anthropic.js";

const start = (input, type = "tool_use") => ({
  type: "content_block_start",
  index: 0,
  content_block: {
    type,
    id: "weather",
    name: "weather",
    input,
    ...(type === "mcp_tool_use" ? { server_name: "weather-tools" } : {}),
  },
});
const delta = (partial_json) => ({
  type: "content_block_delta",
  index: 0,
  delta: { type: "input_json_delta", partial_json },
});
const stop = { type: "content_block_stop", index: 0 };

test("Anthropic retains initial arguments at block stop and EOF", () => {
  const input = JSON.parse('{"city":"Paris","__proto__":{"safe":true}}');
  for (const type of ["tool_use", "server_tool_use", "mcp_tool_use"]) {
    for (const method of ["push", "pushAll"]) {
      for (const blockStop of [false, true]) {
        const pool = createStructuredStreamPool();
        const stream = anthropic(pool);
        stream[method](start(input, type));
        stream[method](delta(""));
        if (blockStop) stream[method](stop);
        const results = stream.finish();
        assert.deepEqual(
          results.map(({ value }) => value),
          [input],
        );
        assert.equal(Object.getPrototypeOf(results[0].value), Object.prototype);
        assert.equal(pool.size, 0);
        assert.equal(stream.finish().length, 1);
      }
    }
  }
});

test("Anthropic argument deltas supersede initial arguments", () => {
  for (const blockStop of [false, true]) {
    const stream = anthropic();
    stream.push(start({ city: "Paris" }));
    stream.push(delta('{"city":"Ro'));
    stream.push(delta('me"}'));
    if (blockStop) stream.push(stop);
    assert.deepEqual(
      stream.finish().map(({ value }) => value),
      [{ city: "Rome" }],
    );
  }
});

test("Anthropic initial arguments respect limits and never mask invalid deltas", () => {
  for (const [options, text, code] of [
    [{}, '{"city":', "INCOMPLETE_JSON"],
    [{}, '{"city":invalid}', "INVALID_JSON"],
    [{ maxBytes: 2 }, "", "MAX_BYTES_EXCEEDED"],
    [{ maxDepth: 1 }, "", "MAX_DEPTH_EXCEEDED"],
  ]) {
    for (const blockStop of [false, true]) {
      const pool = createStructuredStreamPool(options);
      const stream = anthropic(pool);
      stream.push(start({ city: { name: "Paris" } }));
      assert.throws(
        () => {
          stream.push(delta(text));
          if (blockStop) stream.push(stop);
          else stream.finish();
        },
        { code, id: "weather", adapter: "anthropic" },
      );
      assert.equal(pool.size, 0);
    }
  }
});

test("managed Anthropic reads complete initial arguments in both snapshot modes", async () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const blockStop of [false, true]) {
      const updates = [];
      const events = [start({ city: "Paris" }), delta("")];
      if (blockStop) events.push(stop);
      for await (const update of readStructured(events, {
        integration: anthropic,
        limits: { snapshots },
      }))
        updates.push(update);
      assert.deepEqual(updates.at(-1).value, { city: "Paris" });
      assert.equal(updates.at(-1).type, "complete");
    }
  }
});
