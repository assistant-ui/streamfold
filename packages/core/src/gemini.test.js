import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool } from "./index.js";
import { gemini } from "./gemini.js";

const start = (index, id, args = {}) => ({
  event_type: "step.start", index,
  step: { type: "function_call", id, name: "weather", arguments: args },
});
const delta = (index, args) => ({
  event_type: "step.delta", index,
  delta: { type: "arguments_delta", arguments: args },
});

test("Gemini streams interleaved arguments without parsing the empty placeholder", () => {
  for (const snapshots of ["live", "immutable"]) {
    const stream = gemini(createStructuredStreamPool({ snapshots }));
    assert.equal(stream.pushAll(start(0, "paris"))[0].partialValue, undefined);
    stream.pushAll(start(1, "tokyo"));
    const partial = stream.pushAll(delta(0, '{"city":"Pa'))[0];
    assert.deepEqual(partial.partialValue, { city: "Pa" });
    stream.pushAll(delta(1, '{"city":"Tokyo"}'));
    stream.pushAll(delta(0, 'ris"}'));
    if (snapshots === "immutable") assert.deepEqual(partial.partialValue, { city: "Pa" });
    const completed = stream.pushAll({ event_type: "interaction.completed" });
    assert.deepEqual(completed.map(({ id, type, value }) => ({ id, type, value })), [
      { id: "paris", type: "complete", value: { city: "Paris" } },
      { id: "tokyo", type: "complete", value: { city: "Tokyo" } },
    ]);
    assert.deepEqual(stream.pushAll({ event_type: "interaction.completed" }), []);
    assert.equal(stream.finish().length, 2);
  }
});

test("Gemini preserves complete initial arguments and legacy deltas at EOF", () => {
  const stream = gemini();
  stream.pushAll(start(0, "empty"));
  stream.pushAll(delta(0, ""));
  stream.pushAll(start(1, "object", { city: "Paris" }));
  stream.pushAll(start(2, "legacy", '{"city":'));
  stream.pushAll({
    event_type: "step.delta", index: 2,
    delta: { type: "arguments", partial_arguments: '"Tokyo"}' },
  });
  assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [
    { id: "empty", value: {} },
    { id: "object", value: { city: "Paris" } },
    { id: "legacy", value: { city: "Tokyo" } },
  ]);
});

test("Gemini validates streamed arguments and releases all calls on failure", () => {
  for (const [limits, text, code] of [
    [{ maxBytes: 8 }, '{"city":"Paris"}', "MAX_BYTES_EXCEEDED"],
    [{ maxDepth: 1 }, '{"nested":{}}', "MAX_DEPTH_EXCEEDED"],
    [{}, '{"city":', "INCOMPLETE_JSON"],
  ]) {
    const pool = createStructuredStreamPool(limits);
    const stream = gemini(pool);
    stream.pushAll(start(0, "first"));
    stream.pushAll(start(1, "second"));
    assert.throws(() => {
      stream.pushAll(delta(0, text));
      stream.finish();
    }, { code, id: "first", adapter: "gemini" });
    assert.equal(pool.size, 0);
  }
});
