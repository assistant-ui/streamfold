import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool } from "./index.js";
import { anthropic } from "./anthropic.js";

const start = (index, id, type = "tool_use") => ({
  type: "content_block_start", index,
  content_block: { type, id, name: "weather", input: {} },
});
const delta = (index, partial_json) => ({
  type: "content_block_delta", index,
  delta: { type: "input_json_delta", partial_json },
});
const stop = (index) => ({ type: "content_block_stop", index });

test("Anthropic completes empty tool inputs at block stop and EOF", () => {
  for (const type of ["tool_use", "server_tool_use"]) {
    for (const method of ["push", "pushAll"]) {
      for (const blockStop of [false, true]) {
        const pool = createStructuredStreamPool();
        const stream = anthropic(pool);
        stream[method](start(0, "weather", type));
        stream[method](delta(0, ""));
        if (blockStop) {
          const result = stream[method](stop(0));
          assert.deepEqual((method === "push" ? result : result[0]).value, {});
        }
        assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [
          { id: "weather", value: {} },
        ]);
        assert.equal(pool.size, 0);
        assert.equal(stream.finish().length, 1);
      }
    }
  }
});

test("Anthropic keeps empty and streamed inputs separate across tool blocks", () => {
  const stream = anthropic();
  assert.equal(stream.pushAll(start(0, "empty"))[0].partialValue, undefined);
  stream.pushAll(start(1, "paris"));
  const partial = stream.pushAll(delta(1, '{"city":"Pa'))[0];
  assert.deepEqual(partial.partialValue, { city: "Pa" });
  stream.pushAll(delta(1, 'ris"}'));
  assert.deepEqual(stream.pushAll(stop(1))[0].value, { city: "Paris" });
  assert.deepEqual(stream.pushAll(stop(0))[0].value, {});
  assert.deepEqual(stream.pushAll(stop(0)), []);
  assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [
    { id: "paris", value: { city: "Paris" } },
    { id: "empty", value: {} },
  ]);
});

test("Anthropic empty placeholders do not hide invalid arguments or bypass limits", () => {
  for (const [limits, text, code] of [
    [{}, '{"city":', "INCOMPLETE_JSON"],
    [{}, '{"city":invalid}', "INVALID_JSON"],
    [{ maxBytes: 1 }, "", "MAX_BYTES_EXCEEDED"],
  ]) {
    for (const blockStop of [false, true]) {
      const pool = createStructuredStreamPool(limits);
      const stream = anthropic(pool);
      stream.pushAll(start(0, "weather"));
      assert.throws(() => {
        stream.pushAll(delta(0, text));
        if (blockStop) stream.pushAll(stop(0));
        else stream.finish();
      }, { code, id: "weather", adapter: "anthropic" });
      assert.equal(pool.size, 0);
    }
  }
});
