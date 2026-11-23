import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { anthropic } from "./anthropic.js";

const start = (index, id, type = "tool_use", input = {}) => ({
  type: "content_block_start", index,
  content_block: { type, id, name: "weather", input, ...(type === "mcp_tool_use" ? { server_name: "weather-tools" } : {}) },
});
const delta = (index, partial_json) => ({
  type: "content_block_delta", index,
  delta: { type: "input_json_delta", partial_json },
});
const stop = (index) => ({ type: "content_block_stop", index });

test("Anthropic completes empty tool inputs at block stop and fails at EOF without it", () => {
  for (const type of ["tool_use", "server_tool_use", "mcp_tool_use"]) {
    for (const method of ["push", "pushAll"]) {
      for (const blockStop of [false, true]) {
        const pool = createStructuredStreamPool();
        const stream = anthropic(pool);
        stream[method](start(0, "weather", type));
        stream[method](delta(0, ""));
        if (!blockStop) {
          assert.throws(() => stream.finish(), {
            code: "INTEGRATION_ERROR",
            id: "weather",
            adapter: "anthropic",
          });
          assert.equal(pool.size, 0);
          continue;
        }
        const result = stream[method](stop(0));
        assert.deepEqual((method === "push" ? result : result[0]).value, {});
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
  assert.equal(stream.pushAll(start(0, "empty", "mcp_tool_use"))[0].partialValue, undefined);
  stream.pushAll(start(1, "paris"));
  const partial = stream.pushAll(delta(1, '{"city":"Pa'))[0];
  assert.deepEqual(partial.partialValue, { city: "Pa" });
  stream.pushAll(delta(1, 'ris"}'));
  assert.deepEqual(stream.pushAll(stop(1))[0].value, { city: "Paris" });
  assert.deepEqual(stream.pushAll(stop(0))[0].value, {});
  assert.deepEqual(stream.pushAll(stop(0)), []);
  assert.deepEqual(stream.pushAll({
    type: "content_block_start", index: 2,
    content_block: { type: "mcp_tool_result", tool_use_id: "empty", content: "Done", is_error: false },
  }), []);
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
      }, {
        code: blockStop || text !== "" ? code : "INTEGRATION_ERROR",
        id: "weather",
        adapter: "anthropic",
      });
      assert.equal(pool.size, 0);
    }
  }
});


test("Anthropic error events abort pending calls and preserve the provider failure", () => {
  for (const method of ["push", "pushAll"]) {
    const pool = createStructuredStreamPool();
    const stream = anthropic(pool);
    stream[method](start(0, "empty"));
    stream[method](start(1, "complete-json"));
    stream[method](delta(1, '{"city":"Paris"}'));
    stream[method](start(2, "partial-json"));
    stream[method](delta(2, '{"city":'));
    const details = { type: "overloaded_error", message: "Overloaded" };
    let failure;
    assert.throws(() => stream[method]({ type: "error", error: details }), (error) => {
      failure = error;
      assert.equal(error.message, "Overloaded");
      assert.equal(error.cause, details);
      assert.equal(error.code, "INTEGRATION_ERROR");
      assert.equal(error.adapter, "anthropic");
      assert.equal(error.eventType, "error");
      return true;
    });
    assert.equal(pool.size, 0);
    assert.throws(() => stream.finish(), (error) => error === failure);
    assert.throws(() => stream[method](stop(0)), (error) => error === failure);
  }
});

test("managed Anthropic reads do not complete arguments after a decoded provider error", async () => {
  const completed = [];
  await assert.rejects(async () => {
    for await (const update of readStructured([
      start(0, "empty"),
      start(1, "complete-json"),
      delta(1, '{"city":"Paris"}'),
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    ], { integration: anthropic })) {
      if (update.type === "complete") completed.push(update);
    }
  }, { message: "Overloaded", code: "INTEGRATION_ERROR", adapter: "anthropic" });
  assert.deepEqual(completed, []);
});

test("Anthropic MCP initial inputs retain byte/depth limits and clean up failures", () => {
  for (const [limits, code] of [
    [{ maxBytes: 2 }, "MAX_BYTES_EXCEEDED"],
    [{ maxDepth: 1 }, "MAX_DEPTH_EXCEEDED"],
  ]) {
    for (const blockStop of [false, true]) {
      const pool = createStructuredStreamPool(limits);
      const stream = anthropic(pool);
      stream.push(start(0, "mcp", "mcp_tool_use", { city: { name: "Paris" } }));
      assert.throws(
        () => {
          if (blockStop) stream.push(stop(0));
          else stream.finish();
        },
        { code: blockStop ? code : "INTEGRATION_ERROR", id: "mcp", adapter: "anthropic" },
      );
      assert.equal(pool.size, 0);
    }
  }
});
