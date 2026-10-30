import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { bedrock } from "./bedrock.js";

const start = (index, id) => ({ contentBlockStart: { contentBlockIndex: index, start: { toolUse: { toolUseId: id, name: "weather" } } } });
const delta = (index, input) => ({ contentBlockDelta: { contentBlockIndex: index, delta: { toolUse: { input } } } });
const stop = (index) => ({ contentBlockStop: { contentBlockIndex: index } });

test("Bedrock correlates interleaved tool blocks and ignores other content", async () => {
  const events = [
    { messageStart: { role: "assistant" } },
    { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Checking weather" } } },
    stop(0), start(1, "paris"), start(2, "tokyo"),
    delta(1, '{"city":"Pa'), delta(2, '{"city":"Tokyo"}'), delta(1, 'ris"}'),
    stop(2), stop(1), stop(1), { messageStop: { stopReason: "tool_use" } },
    { metadata: { usage: { inputTokens: 10, outputTokens: 20 } } },
  ];
  const updates = [];
  for await (const update of readStructured(events, { integration: bedrock, limits: { snapshots: "immutable" } })) updates.push(update);
  assert.deepEqual(updates.map(({ type, id }) => [type, id]), [
    ["start", "paris"], ["start", "tokyo"], ["update", "paris"], ["update", "tokyo"],
    ["update", "paris"], ["complete", "tokyo"], ["complete", "paris"],
  ]);
  assert.deepEqual(updates[2].partialValue, { city: "Pa" });
  assert.deepEqual(updates.slice(-2).map(({ value }) => value), [{ city: "Tokyo" }, { city: "Paris" }]);
});

test("Bedrock finalizes complete pending inputs at EOF and preserves manual history", () => {
  const stream = bedrock();
  stream.push(start(0, "empty"));
  stream.push(delta(0, "{}"));
  assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [{ id: "empty", value: {} }]);
  assert.equal(stream.finish().length, 1);
});

test("Bedrock rejects truncation, parser limits, and service errors without retaining active calls", () => {
  for (const [options, input, ending, message] of [
    [{}, '{"city":', stop(0), /complete|incomplete/i],
    [{ maxBytes: 4 }, '{"city":"Paris"}', stop(0), /maxBytes/],
    [{}, '{"city":"Paris"}', { modelStreamErrorException: { message: "model failed" } }, /model failed/],
  ]) {
    const pool = createStructuredStreamPool(options);
    const stream = bedrock(pool);
    stream.push(start(0, "first"));
    stream.push(start(1, "second"));
    assert.throws(() => { stream.push(delta(0, input)); stream.push(ending); }, message);
    assert.equal(pool.size, 0);
    assert.throws(() => stream.finish(), message);
  }
});

test("Bedrock diagnoses uncorrelated deltas and missing block indexes", () => {
  const diagnostics = [];
  const stream = bedrock(undefined, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
  stream.push({ contentBlockStart: { start: { toolUse: { toolUseId: "missing-index" } } } });
  stream.push(delta(8, "{}"));
  assert.deepEqual(stream.finish(), []);
  assert.equal(diagnostics.filter(({ code }) => code === "UNMATCHED_TOOL_EVENT").length, 2);
});
