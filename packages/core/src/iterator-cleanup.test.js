import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { defineAdapter, readStructured } from "./index.js";

const adapter = defineAdapter((event) => event);
const breakAfterStart = async (source) => {
  for await (const value of source) {
    assert.ok(value);
    break;
  }
};
const createSource = (symbol, close) => ({
  [symbol]() {
    return this;
  },
  next() {
    return { done: false, value: [{ type: "start", id: "a" }] };
  },
  return: close,
});

test("managed cleanup rejects invalid return results like native for-await", async () => {
  for (const symbol of [Symbol.iterator, Symbol.asyncIterator]) {
    for (const result of [undefined, null, false, 1, "done", 1n, Symbol("done")]) {
      await assert.rejects(breakAfterStart(createSource(symbol, () => result)), TypeError);
      for (const signal of [undefined, new AbortController().signal]) {
        let closes = 0;
        const source = createSource(symbol, function () {
          assert.equal(this, source);
          closes++;
          return result;
        });
        await assert.rejects(
          breakAfterStart(readStructured(source, { adapter, signal })),
          TypeError,
        );
        assert.equal(closes, 1);
        if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
      }
    }
  }
});

test("managed cleanup accepts absent methods and object or function results", async () => {
  for (const symbol of [Symbol.iterator, Symbol.asyncIterator]) {
    for (const close of [undefined, null, () => ({}), () => function result() {}]) {
      await breakAfterStart(createSource(symbol, close));
      await breakAfterStart(readStructured(createSource(symbol, close), { adapter }));
    }
  }
});

test("sync cleanup reads done before value without awaiting the result itself", async () => {
  for (const managed of [false, true]) {
    const accessed = [];
    const source = createSource(Symbol.iterator, () => ({
      // eslint-disable-next-line unicorn/no-thenable -- Verify that sync cleanup does not await its result.
      get then() {
        throw new Error("sync result was awaited");
      },
      get done() {
        accessed.push("done");
        return true;
      },
      get value() {
        accessed.push("value");
        return Promise.resolve();
      },
    }));
    await breakAfterStart(managed ? readStructured(source, { adapter }) : source);
    assert.deepEqual(accessed, ["done", "value"]);
  }
});

test("async cleanup validates the awaited result without reading its fields", async () => {
  for (const signal of [undefined, new AbortController().signal]) {
    const invalid = createSource(Symbol.asyncIterator, () => Promise.resolve(1));
    await assert.rejects(breakAfterStart(readStructured(invalid, { adapter, signal })), TypeError);
    const valid = createSource(Symbol.asyncIterator, () =>
      Promise.resolve({
        get done() {
          throw new Error("async done was read");
        },
        get value() {
          throw new Error("async value was read");
        },
      }),
    );
    await breakAfterStart(readStructured(valid, { adapter, signal }));
  }
});

test("cleanup failures preserve source, consumer, and abort failures", async () => {
  for (const symbol of [Symbol.iterator, Symbol.asyncIterator]) {
    for (const mode of ["source", "consumer", "abort"]) {
      const controller = new AbortController();
      const primary = new Error("primary failure");
      let closes = 0;
      const source = createSource(symbol, () => {
        closes++;
        return undefined;
      });
      let failRead = false;
      const next = source.next;
      source.next = function () {
        if (failRead) throw primary;
        return Reflect.apply(next, this, []);
      };
      const consume = async () => {
        for await (const update of readStructured(source, { adapter, signal: controller.signal })) {
          assert.equal(update.id, "a");
          if (mode === "source") failRead = true;
          if (mode === "consumer") throw primary;
          if (mode === "abort") controller.abort(primary);
        }
      };
      await assert.rejects(consume(), (error) => error === primary);
      assert.equal(closes, 1);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    }
  }
});

test("cleanup method and sync result getter failures reach the caller", async () => {
  const failure = new Error("cleanup getter failed");
  for (const symbol of [Symbol.iterator, Symbol.asyncIterator]) {
    const source = createSource(symbol);
    Object.defineProperty(source, "return", {
      get() {
        throw failure;
      },
    });
    await assert.rejects(
      breakAfterStart(readStructured(source, { adapter })),
      (error) => error === failure,
    );
    await assert.rejects(
      breakAfterStart(readStructured(createSource(symbol, 1), { adapter })),
      TypeError,
    );
  }
  const source = createSource(Symbol.iterator, () => ({
    get done() {
      throw failure;
    },
    get value() {
      return assert.fail("value must not be read after done throws");
    },
  }));
  await assert.rejects(
    breakAfterStart(readStructured(source, { adapter })),
    (error) => error === failure,
  );
});
