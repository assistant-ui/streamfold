import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { defineAdapter, readStructured } from "./index.js";

const adapter = defineAdapter((event) => event);
const events = [[{ type: "start", id: "a" }], [{ type: "delta", id: "a", text: '{"ok":true}' }]];
const collect = async (source) => {
  const values = [];
  for await (const value of source) values.push(structuredClone(value));
  return values;
};
const createSource = (symbol, result) => {
  let index = 0;
  return {
    [symbol]() {
      return this;
    },
    next() {
      return result(index >= events.length, events[index++]);
    },
  };
};

test("managed reads accept callable result objects like native for-await", async () => {
  for (const symbol of [Symbol.iterator, Symbol.asyncIterator]) {
    const result = (done, value) => Object.assign(function iteratorResult() {}, { done, value });
    assert.deepEqual(await collect(createSource(symbol, result)), events);
    for (const signal of [undefined, new AbortController().signal]) {
      const values = await collect(
        readStructured(createSource(symbol, result), { adapter, signal }),
      );
      assert.deepEqual(
        values.map(({ type }) => type),
        ["start", "update", "complete"],
      );
      assert.deepEqual(values.at(-1).value, { ok: true });
      if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
    }
  }
});

test("sync reads inspect done then await value without awaiting the result", async () => {
  for (const managed of [false, true]) {
    for (const signal of [undefined, new AbortController().signal]) {
      const accessed = [];
      const source = createSource(Symbol.iterator, (done, value) => ({
        // eslint-disable-next-line unicorn/no-thenable -- Native sync iteration must ignore this getter.
        get then() {
          throw new Error("sync result was awaited");
        },
        get done() {
          accessed.push("done");
          return done;
        },
        get value() {
          accessed.push("value");
          return Promise.resolve(value);
        },
      }));
      const values = await collect(managed ? readStructured(source, { adapter, signal }) : source);
      assert.deepEqual(accessed, ["done", "value", "done", "value", "done", "value"]);
      if (managed) assert.deepEqual(values.at(-1).value, { ok: true });
      else assert.deepEqual(values, events);
      if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
    }
  }
});

test("invalid next results reject and close once without replacing the read failure", async () => {
  for (const symbol of [Symbol.iterator, Symbol.asyncIterator]) {
    for (const result of [undefined, null, false, 1, "invalid", 1n, Symbol("invalid")]) {
      await assert.rejects(collect(createSource(symbol, () => result)), TypeError);
      for (const signal of [undefined, new AbortController().signal]) {
        let closes = 0;
        const source = createSource(symbol, () => result);
        source.return = () => {
          closes++;
          throw new Error("cleanup failure");
        };
        const updates = readStructured(source, { adapter, signal });
        await assert.rejects(collect(updates), TypeError);
        assert.equal(closes, 1);
        assert.equal((await updates.next()).done, true);
        if (signal) assert.equal(getEventListeners(signal, "abort").length, 0);
      }
    }
  }
});

test("a throwing sync done getter prevents value access and preserves its failure", async () => {
  const failure = new Error("done getter failed");
  for (const managed of [false, true]) {
    const source = createSource(Symbol.iterator, () => ({
      get done() {
        throw failure;
      },
      get value() {
        return assert.fail("value was read after done threw");
      },
    }));
    await assert.rejects(
      collect(managed ? readStructured(source, { adapter }) : source),
      (error) => error === failure,
    );
  }
});

test("async reads await result objects without unwrapping their values", async () => {
  const payload = Promise.resolve(events[0]);
  for (const managed of [false, true]) {
    for (const signal of [undefined, new AbortController().signal]) {
      let reads = 0;
      const seen = [];
      const source = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          return Promise.resolve({ done: reads++ > 0, value: payload });
        },
      };
      if (managed) {
        const observe = defineAdapter((value) => {
          seen.push(value);
          return [];
        });
        await collect(readStructured(source, { adapter: observe, signal }));
      } else {
        for await (const value of source) seen.push(value);
      }
      assert.equal(seen.length, 1);
      assert.equal(seen[0], payload);
    }
  }
});
