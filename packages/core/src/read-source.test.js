import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { defineAdapter, readStructured } from "./index.js";

const adapter = defineAdapter((event) => event);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
};

test("managed sync iterators unwrap promised events before mapping them", async () => {
  for (const signal of [undefined, new AbortController().signal]) {
    let closed = false;
    function* source() {
      try {
        yield Promise.resolve([{ type: "start", id: "a" }]);
        yield Promise.resolve([{ type: "delta", id: "a", text: '{"ok":true}' }]);
      } finally {
        closed = true;
      }
    }
    const updates = [];
    for await (const update of readStructured(source(), { adapter, signal })) {
      updates.push(structuredClone(update));
    }
    assert.deepEqual(
      updates.map(({ type }) => type),
      ["start", "update", "complete"],
    );
    assert.deepEqual(updates.at(-1).value, { ok: true });
    assert.equal(closed, true);
  }
});

test("a rejected sync yield closes the source and preserves its rejection", async () => {
  for (const signal of [undefined, new AbortController().signal]) {
    const failure = new Error("event unavailable");
    let closed = false;
    function* source() {
      try {
        yield [{ type: "start", id: "a" }];
        yield Promise.reject(failure);
      } finally {
        closed = true;
      }
    }
    const updates = readStructured(source(), { adapter, signal });
    assert.equal((await updates.next()).value.type, "start");
    await assert.rejects(updates.next(), (error) => error === failure);
    assert.equal(closed, true);
    assert.equal((await updates.next()).done, true);
  }
});

test("early break awaits a sync generator's promised cleanup", async () => {
  for (const signal of [undefined, new AbortController().signal]) {
    const cleanup = deferred();
    const started = deferred();
    let closes = 0;
    function* source() {
      try {
        yield [{ type: "start", id: "a" }];
      } finally {
        closes++;
        started.resolve();
        // eslint-disable-next-line no-unsafe-finally -- Exercise a sync generator's completion value.
        return cleanup.promise;
      }
    }
    let finished = false;
    const consume = (async () => {
      for await (const update of readStructured(source(), { adapter, signal })) {
        assert.equal(update.id, "a");
        break;
      }
      finished = true;
    })();
    await started.promise;
    try {
      await setImmediate();
      assert.equal(finished, false);
    } finally {
      cleanup.resolve();
      await consume;
    }
    assert.equal(closes, 1);
    if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
  }
});

test("sync cleanup rejections reach the caller without replacing primary failures", async () => {
  for (const mode of ["return", "source", "consumer", "abort"]) {
    for (const signalled of [false, true]) {
      if (mode === "abort" && !signalled) continue;
      const controller = new AbortController();
      const signal = signalled ? controller.signal : undefined;
      const primary = new Error("original failure");
      const cleanup = new Error("cleanup failed");
      let closes = 0;
      let reads = 0;
      const source = {
        [Symbol.iterator]() {
          return this;
        },
        next() {
          if (reads++ === 0) return { done: false, value: [{ type: "start", id: "a" }] };
          throw primary;
        },
        return() {
          closes++;
          return { done: true, value: Promise.reject(cleanup) };
        },
      };
      const consume = async () => {
        for await (const update of readStructured(source, { adapter, signal })) {
          assert.equal(update.id, "a");
          if (mode === "return") break;
          if (mode === "consumer") throw primary;
          if (mode === "abort") controller.abort(primary);
        }
      };
      await assert.rejects(consume(), (error) => error === (mode === "return" ? cleanup : primary));
      await setImmediate();
      assert.equal(closes, 1);
      if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
    }
  }
});

test("async iterator return values are not unwrapped as sync cleanup", async () => {
  let closes = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      return { done: false, value: [{ type: "start", id: "a" }] };
    },
    return() {
      closes++;
      return {
        done: true,
        get value() {
          throw new Error("async return value was read");
        },
      };
    },
  };
  for await (const update of readStructured(source, { adapter })) {
    assert.equal(update.id, "a");
    break;
  }
  assert.equal(closes, 1);
});

test("abort interrupts promised sync cleanup and observes its late rejection", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const cleanup = deferred();
  const started = deferred();
  let closes = 0;
  function* source() {
    try {
      yield [{ type: "start", id: "a" }];
    } finally {
      closes++;
      started.resolve();
      // eslint-disable-next-line no-unsafe-finally -- Exercise a sync generator's completion value.
      return cleanup.promise;
    }
  }
  const updates = readStructured(source(), { adapter, signal: controller.signal });
  await updates.next();
  const closing = updates.return();
  await started.promise;
  controller.abort(reason);
  await assert.rejects(closing, (error) => error === reason);
  cleanup.reject(new Error("late cleanup failure"));
  await setImmediate();
  assert.equal(closes, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
