import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter, IncrementalJsonScanner, readStructured } from "./index.js";

const adapter = defineAdapter((operations) => operations);
const events = [
  [{ type: "start", id: "a" }, { type: "start", id: "b" }],
  [{ type: "delta", id: "a", text: '{"city":"San' }],
  [],
  [
    { type: "delta", id: "b", text: "42" },
    { type: "delta", id: "a", text: ' Francisco"}' },
    { type: "end", id: "a" },
  ],
];

const collect = async (source) => {
  const updates = [];
  for await (const update of source) updates.push(structuredClone(update));
  return updates;
};

test("managed consumption matches the manual API, including remaining calls at EOF", async () => {
  const manual = adapter();
  const expected = [];
  try {
    for (const event of events) {
      expected.push(...structuredClone(manual.pushAll(event)));
    }
    expected.push(...manual.finish());
  } finally {
    manual.dispose();
  }

  async function* asyncEvents() {
    yield* events;
  }

  for (const source of [events, asyncEvents()]) {
    const actual = await collect(readStructured(source, { adapter }));
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual.filter((update) => "value" in update).map(({ id }) => id), ["a", "b"]);
    assert.deepEqual(actual[2].partialValue, { city: "San" });
    assert.equal(actual.at(-1).value, 42);
  }
});

test("ignores empty events and aborts calls without emitting completions", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  assert.deepEqual(await collect(readStructured([], { adapter })), []);
  assert.deepEqual(await collect(readStructured([[], []], { adapter })), []);
  const updates = await collect(readStructured([
    [{ type: "start", id: 1 }],
    [{ type: "abort", id: 1 }],
  ], { adapter }));
  assert.equal(updates.length, 1);
  assert.equal(dispose.mock.callCount(), 1);
});

test("creates sessions lazily and gives concurrent reads separate parser pools", async (t) => {
  const factory = t.mock.fn(adapter);
  const first = readStructured(events, { adapter: factory });
  const unused = readStructured(events, { adapter: factory });
  assert.equal(factory.mock.callCount(), 0);
  await unused.return();
  assert.equal(factory.mock.callCount(), 0);

  const second = readStructured(events, { adapter: factory });
  const [a, b] = await Promise.all([collect(first), collect(second)]);
  assert.deepEqual(a, b);
  assert.equal(factory.mock.callCount(), 2);
});

test("an early break closes the source and disposes every active parser", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  let pulled = 0;
  let closed = false;
  async function* source() {
    try {
      pulled++;
      yield [{ type: "start", id: 1 }, { type: "start", id: 2 }];
      pulled++;
      yield [{ type: "delta", id: 1, text: "{}" }];
    } finally {
      closed = true;
    }
  }
  for await (const update of readStructured(source(), { adapter })) {
    assert.equal(update.id, 1);
    break;
  }
  assert.equal(pulled, 1);
  assert.equal(closed, true);
  assert.equal(dispose.mock.callCount(), 2);
});

test("consumer errors close synchronous sources and preserve the original error", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  let closed = false;
  function* source() {
    try {
      yield [{ type: "start", id: 1 }];
    } finally {
      closed = true;
    }
  }
  const failure = new Error("render failed");
  await assert.rejects(async () => {
    for await (const update of readStructured(source(), { adapter })) {
      assert.equal(update.id, 1);
      throw failure;
    }
  }, (error) => error === failure);
  assert.equal(closed, true);
  assert.equal(dispose.mock.callCount(), 1);
});

test("source failures abandon incomplete calls without trying to finalize them", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const finish = t.mock.method(IncrementalJsonScanner.prototype, "finish");
  const failure = new Error("connection lost");
  async function* source() {
    yield [
      { type: "start", id: 1 },
      { type: "delta", id: 1, text: "{" },
    ];
    throw failure;
  }
  await assert.rejects(collect(readStructured(source(), { adapter })), (error) => error === failure);
  assert.equal(finish.mock.callCount(), 0);
  assert.equal(dispose.mock.callCount(), 1);
});

test("mapper failures close the source and release parser state", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const failure = new Error("unrecognized envelope");
  const failingAdapter = defineAdapter((event) => {
    if (event === "fail") throw failure;
    return event;
  });
  let closed = false;
  async function* source() {
    try {
      yield [{ type: "start", id: 1 }];
      yield "fail";
    } finally {
      closed = true;
    }
  }
  await assert.rejects(collect(readStructured(source(), { adapter: failingAdapter })), (error) => error === failure);
  assert.equal(closed, true);
  assert.equal(dispose.mock.callCount(), 1);
});

test("invalid final JSON rejects and disposes all active calls", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  await assert.rejects(collect(readStructured([
    [
      { type: "start", id: 1 },
      { type: "delta", id: 1, text: "{" },
      { type: "start", id: 2 },
    ],
  ], { adapter })), SyntaxError);
  assert.equal(dispose.mock.callCount(), 2);
});

test("forwards pool limits and closes the source when they are exceeded", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  let closed = false;
  async function* source() {
    try {
      yield [{ type: "start", id: 1 }, { type: "start", id: 2 }];
    } finally {
      closed = true;
    }
  }
  await assert.rejects(collect(readStructured(source(), {
    adapter,
    limits: { maxActiveStreams: 1 },
  })), /maxActiveStreams/);
  assert.equal(closed, true);
  assert.equal(dispose.mock.callCount(), 1);
});

test("does not pull another source event until the current batch is consumed", async () => {
  let pulled = 0;
  async function* source() {
    pulled++;
    yield [{ type: "start", id: 1 }, { type: "start", id: 2 }];
    pulled++;
    yield [{ type: "abort", id: 1 }, { type: "abort", id: 2 }];
  }
  const updates = readStructured(source(), { adapter });
  assert.equal((await updates.next()).value.id, 1);
  assert.equal(pulled, 1);
  assert.equal((await updates.next()).value.id, 2);
  assert.equal(pulled, 1);
  assert.equal((await updates.next()).done, true);
  assert.equal(pulled, 2);
});

test("disposes even when iterator acquisition or source cleanup throws", async (t) => {
  const dispose = t.mock.fn();
  const session = { pushAll: () => [{}], finish: () => [], dispose };
  const factory = () => session;
  const failure = new Error("iterator unavailable");
  const brokenSource = {
    [Symbol.asyncIterator]() { throw failure; },
  };
  await assert.rejects(collect(readStructured(brokenSource, { adapter: factory })), (error) => error === failure);
  assert.equal(dispose.mock.callCount(), 1);

  const source = {
    [Symbol.asyncIterator]() { return this; },
    async next() { return { value: [], done: false }; },
    async return() { throw failure; },
  };
  const updates = readStructured(source, { adapter: factory });
  await updates.next();
  await assert.rejects(updates.return(), (error) => error === failure);
  assert.equal(dispose.mock.callCount(), 2);
});
