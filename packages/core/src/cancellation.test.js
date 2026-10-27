import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter, IncrementalJsonScanner, readStructured } from "./index.js";
import { vercelAI } from "./vercel-ai.js";

const adapter = defineAdapter((event) => event);
const start = [{ type: "start", id: "a" }];
const collect = async (source) => {
  const result = [];
  for await (const update of source) result.push(update);
  return result;
};

test("pre-aborted reads never create a session or acquire the source", async () => {
  const reason = new Error("cancelled");
  await assert.rejects(collect(readStructured({
    [Symbol.asyncIterator]() { assert.fail("source acquired"); },
  }, {
    adapter() { assert.fail("session created"); },
    signal: AbortSignal.abort(reason),
  })), (error) => error === reason);
});

test("abort interrupts a stalled next and does not wait for return", { timeout: 1000 }, async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const controller = new AbortController();
  const reason = new Error("stop");
  let closeCount = 0;
  let calls = 0;
  let rejectLate;
  const source = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (calls++ === 0) return Promise.resolve({ value: start, done: false });
      return new Promise((_, reject) => { rejectLate = reject; });
    },
    return() { closeCount++; return new Promise(() => {}); },
  };
  const updates = readStructured(source, { adapter, signal: controller.signal });
  await updates.next();
  const pending = updates.next();
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(dispose.mock.callCount(), 1);
  assert.equal(closeCount, 1);
  rejectLate(new Error("late upstream failure"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("abort releases SDK parsers while paused within a batch", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const controller = new AbortController();
  const updates = readStructured([
    { type: "tool-input-start", id: "a" },
  ], { integration: vercelAI, signal: controller.signal });
  assert.equal((await updates.next()).value.type, "start");
  controller.abort();
  assert.equal(dispose.mock.callCount(), 1);
  await assert.rejects(updates.next(), { name: "AbortError" });
  assert.equal(dispose.mock.callCount(), 1);
});

test("abort discards remaining custom batch updates without finalization", async () => {
  const controller = new AbortController();
  const updates = readStructured([[
    ...start, { type: "delta", id: "a", text: "{}" }, { type: "end", id: "a" },
  ]], { adapter, signal: controller.signal });
  await updates.next();
  controller.abort("stop");
  await assert.rejects(updates.next(), (error) => error === "stop");
});

test("abort cancels and unlocks a ReadableStream even if cancel never settles", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  let cancelled;
  const source = new ReadableStream({
    start(stream) { stream.enqueue(start); },
    cancel(reason) { cancelled = reason; return new Promise(() => {}); },
  });
  const updates = readStructured(source, { adapter, signal: controller.signal });
  await updates.next();
  const pending = updates.next();
  controller.abort("stop");
  await assert.rejects(pending, (error) => error === "stop");
  assert.equal(cancelled, "stop");
  assert.equal(source.locked, false);
});

test("normal EOF and early break remove abort listeners and preserve cleanup", async (t) => {
  for (const early of [false, true]) {
    const controller = new AbortController();
    const add = t.mock.method(controller.signal, "addEventListener");
    const remove = t.mock.method(controller.signal, "removeEventListener");
    let returned = false;
    function* source() {
      try {
        yield Promise.resolve(start);
        yield [{ type: "delta", id: "a", text: "{}" }];
      } finally { returned = true; }
    }
    const values = [];
    for await (const update of readStructured(source(), { adapter, signal: controller.signal })) {
      values.push(update);
      if (early) break;
    }
    assert.equal(returned, true);
    assert.equal(values.at(-1).type, early ? "start" : "complete");
    assert.ok(add.mock.callCount() > 0);
    assert.equal(remove.mock.callCount(), add.mock.callCount());
  }
});

test("source and parser errors preserve identity when iterator cleanup fails", async () => {
  for (const parserFailure of [false, true]) {
    const failure = new Error("source failed");
    const source = {
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (!parserFailure) throw failure;
        return { value: [{ type: "delta", id: "missing", text: "{}" }], done: false };
      },
      return() { throw new Error("cleanup failed"); },
    };
    await assert.rejects(collect(readStructured(source, {
      adapter, signal: new AbortController().signal,
    })), (error) => parserFailure ? error.code === "UNKNOWN_STREAM" : error === failure);
  }
});

test("abort during early-return cleanup settles promptly", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const updates = readStructured({
    [Symbol.asyncIterator]() { return this; },
    next() { return { value: start, done: false }; },
    return() { controller.abort(); return new Promise(() => {}); },
  }, { adapter, signal: controller.signal });
  await updates.next();
  await assert.rejects(updates.return(), { name: "AbortError" });
});

test("abort inside a mapper also releases parsers allocated by its remaining operations", async (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const controller = new AbortController();
  const reentrant = defineAdapter((event) => {
    if (event === "cancel") {
      controller.abort();
      return [{ type: "start", id: "after-abort" }];
    }
    return start;
  });
  const updates = readStructured(["start", "cancel"], { adapter: reentrant, signal: controller.signal });
  await updates.next();
  await assert.rejects(updates.next(), { name: "AbortError" });
  assert.equal(dispose.mock.callCount(), 2);
});

test("an adapter cleanup failure cannot replace the abort reason", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const updates = readStructured([start], {
    signal: controller.signal,
    adapter: () => ({
      pushAll: () => [{ type: "start", id: "a" }],
      finish() { assert.fail("finalized"); },
      dispose() { throw new Error("cleanup failed"); },
    }),
  });
  await updates.next();
  controller.abort(reason);
  await assert.rejects(updates.next(), (error) => error === reason);
});
