import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "streamfold";
import { openAIRealtime } from "streamfold/openai";

const item = (id, args, status = "completed") => ({
  type: "function_call",
  id: "item-" + id,
  call_id: id,
  name: "weather",
  arguments: args,
  status,
});
const added = (response_id, id) => ({
  type: "response.output_item.added",
  response_id,
  item: item(id, "", "in_progress"),
});
const delta = (response_id, call_id, delta) => ({
  type: "response.function_call_arguments.delta",
  response_id,
  call_id,
  delta,
});
const argsDone = (response_id, call_id, args) => ({
  type: "response.function_call_arguments.done",
  response_id,
  call_id,
  arguments: args,
});
const itemDone = (response_id, call) => ({
  type: "response.output_item.done",
  response_id,
  item: call,
});
const done = (id, status, output) => ({ type: "response.done", response: { id, status, output } });

for (const status of ["cancelled", "incomplete", "failed", "in_progress", undefined]) {
  test(`Realtime rejects response status ${status} after valid arguments`, () => {
    const pool = createStructuredStreamPool();
    const stream = openAIRealtime(pool);
    stream.pushAll(added("r", "a"));
    assert.equal(stream.pushAll(delta("r", "a", "{}"))[0].type, "update");
    assert.deepEqual(stream.pushAll(argsDone("r", "a", "{}")), []);
    assert.deepEqual(stream.pushAll(itemDone("r", item("a", "{}"))), []);
    const terminal = done("r", status, [item("a", "{}")]);
    terminal.response.status_details = { reason: "fixture" };
    assert.throws(() => stream.pushAll(terminal), {
      code: "INTEGRATION_ERROR",
      cause: terminal.response.status_details,
    });
    assert.deepEqual(pool.activeIds, []);
    assert.throws(() => stream.finish(), { code: "INTEGRATION_ERROR" });
  });
}

test("Realtime finalizes only the owning response, in batches", () => {
  const pool = createStructuredStreamPool();
  const stream = openAIRealtime(pool);
  stream.push(added("r1", "a"));
  stream.push(added("r2", "b"));
  stream.push(added("r1", "c"));
  assert.deepEqual(stream.push(delta("r1", "a", '{"city":"P')).partialValue, { city: "P" });
  stream.push(delta("r2", "b", "{}"));
  stream.push(argsDone("r2", "b", '{"ok":true}'));
  stream.push(itemDone("r1", item("c", "{}")));
  assert.deepEqual(stream.pushAll(done("r3", "completed", [])), []);
  const final = done("r1", "completed", [item("a", '{"city":"Paris"}'), item("c", "{}")]);
  assert.deepEqual(
    stream.pushAll(final).map((u) => [u.type, u.id, u.value]),
    [
      ["complete", "a", { city: "Paris" }],
      ["complete", "c", {}],
    ],
  );
  assert.deepEqual(stream.pushAll(final), []);
  assert.deepEqual(pool.activeIds, ["b"]);
  assert.deepEqual(stream.push(done("r2", "completed")).value, { ok: true });
  assert.equal(stream.finish().length, 3);
});

test("Realtime fails closed on truncation and inconsistent ownership", () => {
  for (const terminate of [
    (stream) => stream.finish(),
    (stream) => stream.push(delta("other", "a", " ")),
    (stream) => stream.push(done("r", "completed", [])),
    (stream) => stream.push(done("other", "completed", [item("a", "{}")])),
    (stream) => stream.push(done("r", "completed", [item("a", "{}", "incomplete")])),
  ]) {
    const pool = createStructuredStreamPool();
    const stream = openAIRealtime(pool);
    stream.push(added("r", "a"));
    stream.push(argsDone("r", "a", "{}"));
    assert.throws(() => terminate(stream), { code: "INTEGRATION_ERROR" });
    assert.deepEqual(pool.activeIds, []);
  }
});

test("Realtime ignores unrelated session, audio, text and tool output events", () => {
  const stream = openAIRealtime();
  for (const event of [
    { type: "session.created" },
    { type: "response.output_audio.delta", delta: "AA" },
    { type: "response.output_text.delta", delta: "hi" },
    { type: "response.output_item.added", item: { type: "function_call_output" } },
  ])
    assert.deepEqual(stream.pushAll(event), []);
  assert.deepEqual(stream.finish(), []);
});

test("Realtime early return closes the event source and releases pending calls", async () => {
  let pool;
  let closed = false;
  function* source() {
    try {
      yield added("r", "a");
    } finally {
      closed = true;
    }
  }
  for await (const update of readStructured(source(), {
    integration(ownedPool) {
      pool = ownedPool;
      return openAIRealtime(pool);
    },
  })) {
    assert.equal(update.type, "start");
    break;
  }
  assert.equal(closed, true);
  assert.deepEqual(pool.activeIds, []);
});

test("Realtime accepts whole calls on completed responses and checks their JSON", () => {
  const stream = openAIRealtime();
  assert.deepEqual(
    stream.pushAll(done("r1", "completed", [item("a", "{}")])).map((u) => u.type),
    ["start", "complete"],
  );
  assert.throws(() => stream.pushAll(done("r2", "completed", [item("b", '{"x":')])), {
    code: "INCOMPLETE_JSON",
    id: "b",
  });
});

test("Realtime errors retain provider details and release the pool", () => {
  const pool = createStructuredStreamPool();
  const stream = openAIRealtime(pool);
  stream.pushAll(delta("r", "a", "{}"));
  const error = { type: "server_error", message: "fixture failure" };
  assert.throws(() => stream.pushAll({ type: "error", error }), {
    code: "INTEGRATION_ERROR",
    message: error.message,
    cause: error,
  });
  assert.equal(pool.size, 0);
});
