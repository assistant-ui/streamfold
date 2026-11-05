import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter, readStructured } from "./index.js";

const adapter = defineAdapter((event) => event);

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
