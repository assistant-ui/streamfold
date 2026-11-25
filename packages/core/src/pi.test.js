import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "streamfold";
import { createStructuredStream, pi } from "streamfold/pi";

const start = (contentIndex, id) => ({
  type: "toolcall_start",
  contentIndex,
  partial: {
    content: Array.from({ length: contentIndex + 1 }, (_, index) =>
      index === contentIndex ? { type: "toolCall", id } : { type: "text" },
    ),
  },
});
const delta = (contentIndex, delta) => ({ type: "toolcall_delta", contentIndex, delta });
const end = (contentIndex, id, args) => ({
  type: "toolcall_end",
  contentIndex,
  toolCall: { type: "toolCall", id, arguments: args },
});

test("Pi routes interleaved deltas by index and uses the authoritative end object", () => {
  assert.equal(createStructuredStream, pi);
  const stream = pi();
  stream.push(start(2, "a"));
  stream.push(start(1, "b"));
  stream.push({ type: "thinking_delta", contentIndex: 0, delta: "ignored" });
  const preview = stream.push(delta(2, '{"city":"Pa'));
  assert.equal(preview.id, "a");
  assert.deepEqual(preview.partialValue, { city: "Pa" });
  assert.equal(stream.push(delta(1, '{"x":1}')).id, "b");
  stream.push(end(1, "b", { x: 2 }));
  stream.push(end(2, "a", { city: "Paris" }));
  assert.deepEqual(
    stream.finish().map(({ id, value }) => [id, value]),
    [
      ["b", { x: 2 }],
      ["a", { city: "Paris" }],
    ],
  );
});

test("Pi accepts complete provider inputs without a delta", () => {
  const stream = pi();
  for (const [i, args] of [{}, { city: "Paris" }].entries()) {
    stream.push(start(i, String(i)));
    assert.deepEqual(stream.push(end(i, String(i), args)).value, args);
  }
});

for (const ending of [
  { type: "error", reason: "aborted", error: { errorMessage: "request aborted" } },
  { type: "error", reason: "error", error: { errorMessage: "provider failed" } },
  { type: "done", reason: "length" },
  { type: "done", reason: "toolUse" },
  { ...end(0, "a", {}), toolCall: { id: "a", arguments: {}, argumentsError: "invalid input" } },
  undefined,
]) {
  test(`Pi discards active calls on ${ending?.reason ?? ending?.type ?? "EOF"}`, () => {
    const pool = createStructuredStreamPool();
    const stream = pi(pool);
    stream.push(start(0, "a"));
    stream.push(start(1, "b"));
    stream.push(delta(0, "{}"));
    let failure;
    assert.throws(
      () => (ending ? stream.push(ending) : stream.finish()),
      (err) => {
        failure = err;
        return err.code === "INTEGRATION_ERROR" && err.adapter === "pi";
      },
    );
    assert.equal(pool.size, 0);
    assert.throws(
      () => stream.finish(),
      (err) => err === failure,
    );
  });
}

for (const mode of ["return", "abort"]) {
  test(`Pi releases the source and pending pool on ${mode}`, async () => {
    const controller = new AbortController();
    let pool;
    let closed = false;
    async function* events() {
      try {
        yield start(0, "pending");
      } finally {
        closed = true;
      }
    }
    const reader = readStructured(events(), {
      signal: controller.signal,
      integration(given, options) {
        pool = given;
        return pi(pool, options);
      },
    });
    assert.equal((await reader.next()).value.type, "start");
    if (mode === "abort") {
      controller.abort();
      await assert.rejects(reader.next(), (err) => err === controller.signal.reason);
    } else {
      await reader.return();
    }
    assert.equal(closed, true);
    assert.equal(pool.size, 0);
  });
}

test("Pi waits for the final input when the provider supplies a late ID", () => {
  const stream = pi();
  stream.push(start(0, ""));
  assert.equal(stream.push(delta(0, '{"city":')), undefined);
  const batch = stream.pushAll(end(0, "late", { city: "Paris" }));
  assert.deepEqual(
    batch.map((update) => [update.type, update.id]),
    [
      ["start", "late"],
      ["complete", "late"],
    ],
  );
  assert.deepEqual(batch[1].value, { city: "Paris" });
});

test("an end at the wrong index cannot close a different active Pi call", () => {
  const pool = createStructuredStreamPool();
  const stream = pi(pool);
  stream.push(start(0, "a"));
  assert.throws(() => stream.push(end(1, "a", {})), { code: "INTEGRATION_ERROR" });
  assert.equal(pool.size, 0);
});
