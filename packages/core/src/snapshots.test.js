import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { createStructuredStream, createStructuredStreamPool } from "./index.js";

const assertFrozen = (value) => {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertFrozen(child);
};

test("immutable snapshots preserve history and share unchanged branches", () => {
  const stream = createStructuredStream({ snapshots: "immutable" });
  const first = stream.push(
    '{"stable":{"ok":true},"rows":[{"name":"a',
  ).partialValue;
  const second = stream.push('b"},{"name":"c"}').partialValue;
  assert.deepEqual(first, { stable: { ok: true }, rows: [{ name: "a" }] });
  assert.deepEqual(second.rows, [{ name: "ab" }, { name: "c" }]);
  assert.notEqual(first, second);
  assert.equal(first.stable, second.stable);
  assert.notEqual(first.rows, second.rows);
  assert.notEqual(first.rows[0], second.rows[0]);
  const third = stream.push(',{"name":"d"}]}').partialValue;
  assert.equal(second.rows[0], third.rows[0]);
  assert.equal(second.rows[1], third.rows[1]);
  assert.equal(stream.finish().partialValue, third);
  assert.equal(stream.state.partialValue, third);
  assert.equal(stream.value, third);
  assert.equal(stream.getFieldState(["rows", 2, "name"]), "complete");
  for (const value of [first, second, third]) assertFrozen(value);
  assert.throws(() => {
    first.rows[0].name = "changed";
  }, TypeError);
  assert.throws(() => {
    second.rows.push({});
  }, TypeError);
  stream.dispose();
});

test("immutable duplicate keys replace values and invalidate field completion", () => {
  const stream = createStructuredStream({ snapshots: "immutable" });
  const first = stream.push('{"a":{"old":true},"a":').partialValue;
  const second = stream.push('{"new":"par').partialValue;
  assert.deepEqual(first, { a: { old: true } });
  assert.deepEqual(second, { a: { new: "par" } });
  assert.equal(stream.getFieldState(["a"]), "partial");
  assert.equal(stream.getFieldState(["a", "old"]), "partial");
  stream.push('tial"}}');
  assert.equal(stream.getFieldState(["a"]), "complete");
  assert.deepEqual(second, { a: { new: "par" } });
  stream.dispose();
});

test("batched immutable updates preserve history across nested replacements", () => {
  const stream = createStructuredStream({ snapshots: "immutable" });
  try {
    const first = stream.push(
      '{"stable":{"ok":true},"rows":[{"nested":{"old":1',
    ).partialValue;
    const second = stream.push(
      ',"added":2},"nested":{"value":3,"other":4}},{"nested":{"value":5,"other":6}}]}',
    ).partialValue;

    assert.deepEqual(first, { stable: { ok: true }, rows: [{ nested: { old: 1 } }] });
    assert.deepEqual(second, {
      stable: { ok: true },
      rows: [
        { nested: { value: 3, other: 4 } },
        { nested: { value: 5, other: 6 } },
      ],
    });
    assert.equal(first.stable, second.stable);
    assert.notEqual(first.rows, second.rows);
    assert.notEqual(first.rows[0].nested, second.rows[0].nested);
    assertFrozen(first);
    assertFrozen(second);
    assert.equal(stream.finish().partialValue, second);
  } finally {
    stream.dispose();
  }
});

test("replacement negative numbers invalidate completion before their first digit", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const chunks of [['{"a":1,"a":-'], ['{"a":1,"a":', "-"]]) {
      const stream = createStructuredStream({ snapshots });
      try {
        let update;
        for (const chunk of chunks) update = stream.push(chunk);
        assert.deepEqual(update.partialValue, { a: 1 });
        assert.equal(stream.getFieldState(["a"]), "partial");
        assert.equal(stream.getFieldState(["a", "child"]), "partial");
        assert.equal(update.changes.every(({ op }) => ["set", "append", "complete"].includes(op)), true);
        assert.deepEqual(stream.push("").changes, []);
        stream.push("2}");
        assert.deepEqual(stream.finish().partialValue, { a: -2 });
        assert.equal(stream.getFieldState(["a"]), "complete");
      } finally {
        stream.dispose();
      }
    }
  }
});

test("completed containers answer descendant queries while siblings stream", () => {
  for (const snapshots of ["live", "immutable"]) {
    const stream = createStructuredStream({ snapshots });
    try {
      stream.push('{"rows":[{"nested":{"name":"first"}},[true,null]],"tail":"par');
      for (const path of [
        ["rows"],
        ["rows", 0, "nested", "name"],
        ["rows", "0", "nested"],
        ["rows", 1, 0],
        ["rows", 1, 1],
      ]) assert.equal(stream.getFieldState(path), "complete");
      assert.equal(stream.getFieldState([]), "partial");
      assert.equal(stream.getFieldState(["tail"]), "partial");
      assert.equal(stream.getFieldState(["missing"]), "partial");
      stream.push('tial"}');
      assert.equal(stream.getFieldState([]), "complete");
      assert.equal(stream.getFieldState(["rows", 0, "nested", "name"]), "complete");
      assert.equal(stream.getFieldState(["tail"]), "complete");
      assert.deepEqual(stream.finish().partialValue, {
        rows: [{ nested: { name: "first" } }, [true, null]],
        tail: "partial",
      });
    } finally {
      stream.dispose();
    }
  }
});

test("replacing a completed container resets its descendant field states", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const key of ["value", "__proto__", "constructor"]) {
      const stream = createStructuredStream({ snapshots });
      try {
        const prefix = JSON.stringify(key);
        const first = stream.push(`{${prefix}:{"rows":[{"old":true}]}`).partialValue;
        const saved = structuredClone(first);
        assert.equal(stream.getFieldState([key, "rows", 0, "old"]), "complete");
        stream.push(`,${prefix}:{"rows":[{"next":"par`);
        for (const path of [[key], [key, "rows"], [key, "rows", 0], [key, "rows", 0, "old"], [key, "rows", 0, "next"]])
          assert.equal(stream.getFieldState(path), "partial");
        stream.push('tial"}]}');
        assert.equal(stream.getFieldState([key, "rows", 0, "next"]), "complete");
        assert.equal(stream.getFieldState([]), "partial");
        stream.push(`,${prefix}:-`);
        assert.equal(stream.getFieldState([key]), "partial");
        assert.equal(stream.getFieldState([key, "rows", 0, "next"]), "partial");
        stream.push('12}');
        assert.deepEqual(stream.finish().partialValue, JSON.parse(`{${prefix}:-12}`));
        assert.equal(stream.getFieldState([key]), "complete");
        if (snapshots === "immutable") assert.deepEqual(first, saved);
      } finally {
        stream.dispose();
      }
    }
  }
});

test("immutable snapshots handle special keys and every Unicode chunk boundary", () => {
  const text =
    '{"__proto__":{"polluted":true},"constructor":{"name":"x"},"items":[1,true,null,"\\uD83D\\uDE80","é\uD83D\uDE80"]}';
  for (let split = 0; split <= text.length; split++) {
    const stream = createStructuredStream({ snapshots: "immutable" });
    const first = stream.push(text.slice(0, split)).partialValue;
    const saved = structuredClone(first);
    stream.push(text.slice(split));
    const final = stream.finish().partialValue;
    assert.deepEqual(final, JSON.parse(text));
    assert.deepEqual(first, saved);
    assert.equal(Object.getPrototypeOf(final), Object.prototype);
    assert.equal(Object.hasOwn(final, "__proto__"), true);
    assertFrozen(final);
    stream.dispose();
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test("immutable prefixes match live mode across generated chunk schedules", () => {
  fc.assert(
    fc.property(
      fc.jsonValue(),
      fc.integer({ min: 1, max: 32 }),
      (value, chunkSize) => {
        const text = JSON.stringify(value);
        const live = createStructuredStream();
        const immutable = createStructuredStream({ snapshots: "immutable" });
        const history = [];
        try {
          for (let offset = 0; offset < text.length; offset += chunkSize) {
            const chunk = text.slice(offset, offset + chunkSize);
            const snapshot = immutable.push(chunk).partialValue;
            assert.deepEqual(snapshot, live.push(chunk).partialValue);
            assertFrozen(snapshot);
            history.push([snapshot, structuredClone(snapshot)]);
          }
          assert.deepEqual(immutable.finish().partialValue, JSON.parse(text));
          for (const [snapshot, saved] of history)
            assert.deepEqual(snapshot, saved);
        } finally {
          live.dispose();
          immutable.dispose();
        }
      },
    ),
    { numRuns: 100, seed: 513 },
  );
});

test("immutable pools reuse their final frozen snapshot", () => {
  const pool = createStructuredStreamPool({ snapshots: "immutable" });
  const first = pool.start("a", '{"rows":[').partialValue;
  pool.start("b", "42");
  const latest = pool.push("a", '{"ok":true}]}').partialValue;
  const final = pool.finish("a");
  assert.deepEqual(first, { rows: [] });
  assert.equal(final.partialValue, final.value);
  assert.equal(final.value, latest);
  assertFrozen(final.value);
  assertFrozen(final.partialValue);
  assert.equal(pool.finish("b").value, 42);
  assert.equal(pool.size, 0);
});

test("immutable pool final values match JSON across generated chunks and replacements", () => {
  fc.assert(
    fc.property(fc.jsonValue(), fc.jsonValue(), fc.integer({ min: 1, max: 32 }), (input, replacement, chunkSize) => {
      const text = JSON.stringify(input);
      for (const finalText of [undefined, text, JSON.stringify(replacement)]) {
        const pool = createStructuredStreamPool({ snapshots: "immutable" });
        pool.start("a");
        let previous;
        for (let offset = 0; offset < text.length; offset += chunkSize)
          previous = pool.push("a", text.slice(offset, offset + chunkSize)).partialValue;
        const saved = structuredClone(previous);
        const result = pool.finish("a", finalText);
        assert.deepEqual(result.value, JSON.parse(finalText ?? text));
        assert.equal(result.value, result.partialValue);
        assertFrozen(result.value);
        assert.deepEqual(previous, saved);
        assert.equal(result.text, finalText ?? text);
        assert.equal(pool.size, 0);
      }
    }),
    { numRuns: 100, seed: 0x5f03d },
  );
});

test("immutable pool completion preserves numeric, Unicode, and duplicate-key values", () => {
  for (const text of [
    "-0", "1e400", "-1e400", "1e-400", "-1e-400", "9007199254740993", "null", "true", "false",
    '"\\ud800"', '"\\udc00"', '"é🚀"',
    '{"__proto__":{"safe":true},"constructor":{"prototype":{"ok":true}}}',
    '{"a":{"old":true},"a":[-0,"\\ud800",null]}',
  ]) {
    for (let split = 0; split <= text.length; split++) {
      const pool = createStructuredStreamPool({ snapshots: "immutable" });
      pool.start("a", text.slice(0, split));
      pool.push("a", text.slice(split));
      const result = pool.finish("a");
      assert.deepEqual(result.value, JSON.parse(text));
      assert.equal(result.value, result.partialValue);
      assertFrozen(result.value);
    }
  }
});

test("live pool completion isolates final values from consumer mutations", () => {
  for (const options of [{}, { snapshots: "live" }]) {
    const pool = createStructuredStreamPool(options);
    const text = '{"rows":[{"id":1}]}';
    for (const finalText of [undefined, text]) {
      const partial = pool.start("a", text).partialValue;
      partial.rows[0].id = 99;
      partial.rows.push({ id: 2 });
      const result = pool.finish("a", finalText);
      assert.deepEqual(result.value, { rows: [{ id: 1 }] });
      assert.equal(result.partialValue, partial);
      assert.notEqual(result.value, partial);
      result.value.rows[0].id = 3;
      assert.equal(partial.rows[0].id, 99);
    }
  }
});

test("immutable pools reject incomplete final JSON and release the call", () => {
  for (const text of ["", "{", "[1,", '"unfinished', "1e", "1e+"]) {
    const pool = createStructuredStreamPool({ snapshots: "immutable" });
    pool.start("a", text);
    assert.throws(() => pool.finish("a"), { name: "SyntaxError", id: "a", operation: "finish" });
    assert.equal(pool.size, 0);
    pool.start("a", "{}");
    assert.deepEqual(pool.finish("a").value, {});
  }
});

test("live snapshots remain the default and invalid modes fail clearly", () => {
  for (const options of [{}, { snapshots: "live" }]) {
    const stream = createStructuredStream(options);
    const first = stream.push('{"name":"a').partialValue;
    const second = stream.push('b"}').partialValue;
    assert.equal(first, second);
    assert.deepEqual(first, { name: "ab" });
    assert.equal(Object.isFrozen(first), false);
    stream.dispose();
  }
  assert.throws(() => createStructuredStream({ snapshots: "typo" }), {
    name: "TypeError",
    code: "INVALID_OPTIONS",
  });
});
