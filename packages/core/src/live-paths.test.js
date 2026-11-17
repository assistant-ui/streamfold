import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStream, createStructuredStreamPool } from "./index.js";

const expectMissingPath = (run) => {
  let failure;
  assert.throws(run, (error) => {
    failure = error;
    return error instanceof TypeError && /own property/.test(error.message);
  });
  return failure;
};

test("deleted live containers cannot redirect patches into Object.prototype", () => {
  const marker = "streamfoldDeletedContainerProbe";
  assert.equal(Object.hasOwn(Object.prototype, marker), false);
  for (const [prefix, key, suffix] of [
    ['{"__proto__":{', "__proto__", `"${marker}":true}}`],
    ['{"constructor":{"prototype":{', "constructor", `"${marker}":true}}}`],
  ]) {
    const stream = createStructuredStream();
    try {
      const value = stream.push(prefix).partialValue;
      delete value[key];
      const failure = expectMissingPath(() => stream.push(suffix));
      assert.equal(failure.operation, "push");
      assert.equal(Object.hasOwn(Object.prototype, marker), false);
      assert.throws(
        () => stream.push(""),
        (error) => error === failure,
      );
      assert.throws(
        () => stream.finish(),
        (error) => error === failure,
      );
    } finally {
      delete Object.prototype[marker];
      stream.dispose();
    }
  }
});

test("live set and append traversal reject deleted own containers and array items", () => {
  for (const append of [false, true]) {
    for (const array of [false, true]) {
      const stream = createStructuredStream();
      const inherited = { text: "inherited" };
      try {
        const prefix = array ? '{"rows":[{' : '{"row":{';
        const value = stream.push(prefix + (append ? '"text":"a' : "")).partialValue;
        const target = array ? value.rows : value;
        const key = array ? "0" : "row";
        const prototype = Object.create(Object.getPrototypeOf(target));
        Object.defineProperty(prototype, key, { value: inherited });
        Object.setPrototypeOf(target, prototype);
        delete target[key];
        const suffix = (append ? 'b"}' : '"added":true}') + (array ? "]}" : "}");
        expectMissingPath(() => stream.push(suffix));
        assert.deepEqual(inherited, { text: "inherited" });
        assert.equal(Object.hasOwn(target, key), false);
      } finally {
        stream.dispose();
      }
    }
  }
});

test("appending a deleted live leaf never reads an inherited getter", () => {
  for (const key of ["text", "__proto__", "constructor", "toString"]) {
    const stream = createStructuredStream();
    let reads = 0;
    try {
      const value = stream.push(`{${JSON.stringify(key)}:"a`).partialValue;
      const prototype = Object.create(Object.prototype);
      Object.defineProperty(prototype, key, {
        get() {
          reads++;
          return "inherited";
        },
      });
      Object.setPrototypeOf(value, prototype);
      delete value[key];
      expectMissingPath(() => stream.push('b"}'));
      assert.equal(reads, 0);
      assert.equal(Object.hasOwn(value, key), false);
    } finally {
      stream.dispose();
    }
  }
});

test("a missing live path releases its pool call and allows a new call", () => {
  const pool = createStructuredStreamPool();
  try {
    const partial = pool.start("a", '{"row":{').partialValue;
    delete partial.row;
    const failure = expectMissingPath(() => pool.push("a", '"ok":true}}'));
    assert.equal(failure.id, "a");
    assert.equal(failure.operation, "push");
    assert.equal(pool.size, 0);
    pool.start("a", '{"row":{"ok":true}}');
    assert.deepEqual(pool.finish("a").value, { row: { ok: true } });
    assert.equal(pool.size, 0);
  } finally {
    pool.abort("a");
  }
});

test("live paths preserve special keys, nested arrays, duplicate keys, and root strings", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const text of [
      '{"__proto__":{"text":"ab"},"constructor":{"prototype":{"text":"cd"}}}',
      '{"rows":[{"text":"ab"}],"row":{"old":true},"row":{"text":"cd"}}',
      '"root text"',
    ]) {
      for (let split = 0; split <= text.length; split++) {
        const stream = createStructuredStream({ snapshots });
        try {
          const first = stream.push(text.slice(0, split)).partialValue;
          const saved = structuredClone(first);
          stream.push(text.slice(split));
          assert.deepEqual(stream.finish().partialValue, JSON.parse(text));
          if (snapshots === "immutable") assert.deepEqual(first, saved);
        } finally {
          stream.dispose();
        }
      }
    }
  }
});
