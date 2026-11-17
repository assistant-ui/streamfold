import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { defineAdapter, readStructured } from "./index.js";

const adapter = defineAdapter((event) => event);
const events = [[{ type: "start", id: "a" }], [{ type: "delta", id: "a", text: "{}" }]];
const collect = async (source) => {
  const values = [];
  for await (const value of source) values.push(structuredClone(value));
  return values;
};
const sourceWithAccessors = (kind, symbol) => {
  let index = 0,
    nextGets = 0;
  const source = {
    [symbol]() {
      return this;
    },
    get next() {
      if (++nextGets > 1 && kind === "next") throw new Error("next was looked up again");
      return function next() {
        assert.equal(this, source);
        let doneGets = 0,
          thenGets = 0;
        const done = index === events.length,
          value = events[index++];
        return {
          get done() {
            if (++doneGets > 1 && kind === "done") throw new Error("done was read again");
            return done;
          },
          // eslint-disable-next-line unicorn/no-thenable -- Verify the native result assimilation count.
          get then() {
            if (++thenGets > 1 && kind === "then") throw new Error("then was read again");
            return undefined;
          },
          value,
        };
      };
    },
  };
  return source;
};

for (const kind of ["done", "next", "then"]) {
  test(`managed iteration preserves native ${kind} accessor reads`, async () => {
    for (const symbol of kind === "next"
      ? [Symbol.iterator, Symbol.asyncIterator]
      : [Symbol.asyncIterator]) {
      assert.deepEqual(await collect(sourceWithAccessors(kind, symbol)), events);
      for (const signal of [undefined, new AbortController().signal]) {
        const values = await collect(
          readStructured(sourceWithAccessors(kind, symbol), { adapter, signal }),
        );
        assert.deepEqual(
          values.map((value) => value.type),
          ["start", "update", "complete"],
        );
        assert.deepEqual(values.at(-1).value, {});
        if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
      }
    }
  });
}

test("async completion does not read value, while sync completion awaits it", async () => {
  for (const managed of [false, true]) {
    for (const symbol of [Symbol.iterator, Symbol.asyncIterator]) {
      let reads = 0;
      const source = {
        [symbol]() {
          return this;
        },
        next() {
          return {
            done: true,
            get value() {
              assert.equal(symbol, Symbol.iterator);
              reads++;
              return Promise.resolve();
            },
          };
        },
      };
      await collect(managed ? readStructured(source, { adapter }) : source);
      assert.equal(reads, symbol === Symbol.iterator ? 1 : 0);
    }
  }
});

test("result accessor failures retain their error and close the source once", async () => {
  for (const field of ["done", "value", "then"]) {
    for (const signal of [undefined, new AbortController().signal]) {
      const failure = new Error(`${field} getter failed`);
      let closes = 0;
      const source = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          const result = { done: false, value: events[0] };
          Object.defineProperty(result, field, {
            get() {
              throw failure;
            },
          });
          return result;
        },
        return() {
          closes++;
          throw new Error("cleanup failed");
        },
      };
      await assert.rejects(
        collect(readStructured(source, { adapter, signal })),
        (error) => error === failure,
      );
      assert.equal(closes, 1);
      if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
    }
  }
});

test("next getter failures dispose the adapter and leave no abort listener", async () => {
  const failure = new Error("next getter failed");
  const signal = new AbortController().signal;
  let disposed = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return this;
    },
    get next() {
      throw failure;
    },
  };
  const makeAdapter = () => ({
    dispose() {
      disposed++;
    },
  });
  await assert.rejects(
    collect(readStructured(source, { adapter: makeAdapter, signal })),
    (error) => error === failure,
  );
  assert.equal(disposed, 1);
  assert.equal(getEventListeners(signal, "abort").length, 0);
});
