import assert from "node:assert/strict";
import test from "node:test";
import {
  createStructuredStream,
  defineAdapter,
  IncrementalJsonScanner,
} from "./index.js";

const weatherAdapter = defineAdapter((event) => {
  switch (event.kind) {
    case "begin":
      return [{ type: "start", id: event.id }];
    case "piece":
      return [{ type: "delta", id: event.id, text: event.text }];
    case "done":
      return [{ type: "end", id: event.id }];
    default:
      return [];
  }
});

const operationsAdapter = defineAdapter((operations) => operations);

test("maps custom events and finalizes remaining calls without duplicates", () => {
  const stream = weatherAdapter();
  try {
    assert.deepEqual(stream.pushAll({ kind: "ping" }), []);
    assert.equal(stream.pushAll({ kind: "begin", id: "weather" })[0].id, "weather");
    stream.pushAll({ kind: "begin", id: "count" });
    const [partial] = stream.pushAll({
      kind: "piece", id: "weather", text: '{"city":"San',
    });
    assert.deepEqual(partial.partialValue, { city: "San" });
    assert.ok(partial.changes.length > 0);
    stream.pushAll({ kind: "piece", id: "count", text: "42" });
    stream.pushAll({ kind: "piece", id: "weather", text: ' Francisco"}' });
    const [completed] = stream.pushAll({ kind: "done", id: "weather" });
    assert.deepEqual(completed.value, { city: "San Francisco" });
    assert.equal(completed.text, '{"city":"San Francisco"}');
    const [remaining] = stream.finish();
    assert.equal(remaining.id, "count");
    assert.equal(remaining.value, 42);
    assert.deepEqual(stream.finish(), []);
    assert.throws(() => stream.pushAll({ kind: "ping" }), /finished/);
  } finally {
    stream.dispose();
  }
});

test("preserves every update from a multi-call batch in operation order", () => {
  const stream = operationsAdapter();
  const updates = stream.pushAll([
    { type: "start", id: 1 },
    { type: "start", id: 2 },
    { type: "delta", id: 1, text: '{"ok":true}' },
    { type: "delta", id: 2, text: '"hello"' },
    { type: "end", id: 2 },
    { type: "end", id: 1 },
  ]);
  assert.deepEqual(updates.map(({ id }) => id), [1, 2, 1, 2, 2, 1]);
  assert.deepEqual(updates.map(({ type }) => type), ["start", "start", "update", "update", "complete", "complete"]);
  assert.equal(updates[4].value, "hello");
  assert.deepEqual(updates[5].value, { ok: true });
  assert.deepEqual(stream.finish(), []);
  stream.dispose();
});

test("creates isolated sessions and composes with the core factory", () => {
  const first = weatherAdapter();
  const second = createStructuredStream(weatherAdapter);
  for (const stream of [first, second]) {
    stream.pushAll({ kind: "begin", id: "same-id" });
  }
  first.pushAll({ kind: "piece", id: "same-id", text: "1" });
  second.pushAll({ kind: "piece", id: "same-id", text: "2" });
  first.dispose();
  first.dispose();
  assert.throws(() => first.pushAll({ kind: "ping" }), /disposed/);
  assert.throws(() => first.finish(), /disposed/);
  assert.equal(second.finish()[0].value, 2);
  second.dispose();
});

test("aborts without an update, releases parsers, and permits ID reuse", (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const stream = operationsAdapter({ maxActiveStreams: 1 });
  stream.pushAll([{ type: "start", id: "one" }]);
  assert.deepEqual(stream.pushAll([{ type: "abort", id: "one" }]), []);
  assert.equal(dispose.mock.callCount(), 1);
  assert.deepEqual(stream.pushAll([{ type: "abort", id: "one" }]), []);
  stream.pushAll([{ type: "start", id: "one" }]);
  stream.dispose();
  stream.dispose();
  assert.equal(dispose.mock.callCount(), 2);
});

test("mapper failures release the session's active parsers and remain terminal", (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const error = new Error("bad envelope");
  const stream = defineAdapter((event) => {
    if (event === "fail") throw error;
    return event;
  })();
  stream.pushAll([{ type: "start", id: 1 }, { type: "start", id: 2 }]);
  assert.throws(() => stream.pushAll("fail"), (actual) => actual === error);
  assert.equal(dispose.mock.callCount(), 2);
  stream.dispose();
  assert.throws(() => stream.pushAll([]), (actual) => actual === error);
  assert.throws(() => stream.finish(), (actual) => actual === error);
  assert.equal(dispose.mock.callCount(), 2);
});

test("a failed operation discards the batch and releases every active parser", (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const stream = operationsAdapter();
  assert.throws(() => stream.pushAll([
    { type: "start", id: "first" },
    { type: "start", id: "second" },
    { type: "delta", id: "first", text: "!" },
  ]), SyntaxError);
  assert.equal(dispose.mock.callCount(), 2);
  assert.throws(() => stream.finish(), SyntaxError);
});

test("finish failure releases all remaining parsers, including unvisited calls", (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const stream = operationsAdapter();
  stream.pushAll([
    { type: "start", id: 1 },
    { type: "delta", id: 1, text: "42" },
    { type: "start", id: 2 },
    { type: "delta", id: 2, text: "{" },
    { type: "start", id: 3 },
  ]);
  assert.throws(() => stream.finish(), SyntaxError);
  assert.equal(dispose.mock.callCount(), 3);
  assert.throws(() => stream.pushAll([]), SyntaxError);
});

test("enforces pool, byte, and depth limits", () => {
  const cases = [
    [{ maxActiveStreams: 1 }, [{ type: "start", id: 2 }], /maxActiveStreams/],
    [{ maxBytes: 2 }, [{ type: "delta", id: 1, text: '"hi"' }], /maxBytes/],
    [{ maxDepth: 1 }, [{ type: "delta", id: 1, text: "[[" }], /maxDepth/],
  ];
  for (const [options, operations, pattern] of cases) {
    const stream = operationsAdapter(options);
    stream.pushAll([{ type: "start", id: 1 }]);
    assert.throws(() => stream.pushAll(operations), pattern);
    assert.throws(() => stream.finish(), pattern);
  }
  assert.throws(() => weatherAdapter({ maxActiveStreams: 0 }), RangeError);
});

test("rejects duplicate starts and missing IDs without implicitly creating calls", () => {
  for (const operation of [
    { type: "start", id: 1 },
    { type: "delta", id: 2, text: "{}" },
    { type: "end", id: 2 },
  ]) {
    const stream = operationsAdapter();
    stream.pushAll([{ type: "start", id: 1 }]);
    assert.throws(() => stream.pushAll([operation]), /already exists|Unknown/);
  }
});

test("validates JavaScript mapper output and cleans up malformed batches", (t) => {
  assert.throws(() => defineAdapter(null), TypeError);
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  for (const invalid of [
    undefined, {}, [null], [{}], [{ type: "unknown", id: 1 }],
    [{ type: "delta", id: 1, text: 42 }],
  ]) {
    const stream = operationsAdapter();
    stream.pushAll([{ type: "start", id: 1 }]);
    assert.throws(() => stream.pushAll(invalid), TypeError);
  }
  assert.equal(dispose.mock.callCount(), 6);
  const stream = defineAdapter(() => { throw "failure"; })();
  assert.throws(() => stream.pushAll(null), { message: "Adapter stream failed", cause: "failure" });
});
