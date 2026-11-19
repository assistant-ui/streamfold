import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { defineAdapter, readStructured } from "./index.js";

const adapter = defineAdapter((event) => event);
const events = [[{ type: "start", id: "call" }], [{ type: "delta", id: "call", text: "{}" }]];

function readable(mode, reason) {
  let index = 0;
  const counts = { gets: 0, calls: 0, cancels: 0 };
  const source = new ReadableStream(
    {
      pull(controller) {
        if (mode === "error" && index > 0) throw reason;
        if (index < events.length) controller.enqueue(events[index++]);
        else controller.close();
      },
      cancel() {
        counts.cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  const acquire = function () {
    counts.calls++;
    assert.equal(this, source);
    return ReadableStream.prototype.getReader.call(this);
  };
  Object.defineProperty(acquire, "call", {
    get() {
      throw new Error("The acquisition method's call property must not be read.");
    },
  });
  Object.defineProperty(source, "getReader", {
    get() {
      if (++counts.gets > 1) throw new Error("getReader was read twice");
      return acquire;
    },
  });
  return { source, counts };
}

test("accessor-backed native reader acquisition works with one lookup", async () => {
  const { source, counts } = readable("return");
  const reader = source.getReader();
  assert.deepEqual((await reader.read()).value, events[0]);
  await reader.cancel();
  reader.releaseLock();
  assert.deepEqual(counts, { gets: 1, calls: 1, cancels: 1 });
  assert.equal(source.locked, false);
});

for (const mode of ["eof", "return", "error", "abort"]) {
  for (const signalled of mode === "abort" ? [true] : [false, true]) {
    test(`managed reader acquires once on ${mode}, signal=${signalled}`, async () => {
      const reason = new Error("read fixture failed");
      const controller = new AbortController();
      const signal = signalled ? controller.signal : undefined;
      const { source, counts } = readable(mode, reason);
      const completed = [];
      const run = async () => {
        for await (const update of readStructured(source, { adapter, signal })) {
          if (mode === "return") break;
          if (mode === "abort") controller.abort(reason);
          if (update.type === "complete") completed.push(update.value);
        }
      };
      if (mode === "error" || mode === "abort")
        await assert.rejects(run, (error) => error === reason);
      else await run();
      assert.equal(counts.gets, 1);
      assert.equal(counts.calls, 1);
      assert.equal(counts.cancels, mode === "return" || mode === "abort" ? 1 : 0);
      assert.equal(source.locked, false);
      assert.deepEqual(completed, mode === "eof" ? [{}] : []);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
  }
}

test("reader acquisition failures preserve the error and dispose the session", async () => {
  for (const stage of ["getter", "method"]) {
    const failure = new Error(`${stage} failed`);
    const signal = new AbortController().signal;
    let disposed = 0;
    let gets = 0;
    const source = {
      get getReader() {
        gets++;
        if (stage === "getter") throw failure;
        return function () {
          assert.equal(this, source);
          throw failure;
        };
      },
    };
    const run = async () => {
      for await (const _update of readStructured(source, {
        signal,
        adapter: () => ({
          dispose() {
            disposed++;
          },
        }),
      })) {
      }
    };
    await assert.rejects(run, (error) => error === failure);
    assert.equal(gets, 1);
    assert.equal(disposed, 1);
    assert.equal(getEventListeners(signal, "abort").length, 0);
  }
});

test("a non-callable getReader still falls back to the iterable", async () => {
  for (const value of [undefined, null, 1]) {
    let gets = 0;
    const source = {
      get getReader() {
        gets++;
        return value;
      },
      *[Symbol.iterator]() {
        yield* events;
      },
    };
    const completed = [];
    for await (const update of readStructured(source, { adapter })) {
      if (update.type === "complete") completed.push(update.value);
    }
    assert.equal(gets, 1);
    assert.deepEqual(completed, [{}]);
  }
});
