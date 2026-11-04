import assert from "node:assert/strict";
import test from "node:test";
import { createToolInputParser } from "./vercel-ai.js";

test("embedded tool parsers isolate calls and preserve nested partial snapshots", () => {
  const first = createToolInputParser();
  const second = createToolInputParser();
  try {
    const partial = first.push('{"items":[{"text":"hel');
    assert.deepEqual(second.push('{"other":true}'), { other: true });
    assert.deepEqual(first.push('lo"}]}'), { items: [{ text: "hello" }] });
    assert.deepEqual(partial, { items: [{ text: "hel" }] });
    assert.equal(Object.isFrozen(partial.items[0]), true);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("embedded tool parsers preserve split Unicode and escaped lone surrogates", () => {
  const parser = createToolInputParser();
  try {
    assert.deepEqual(parser.push('{"text":"\ud83d'), { text: "" });
    assert.deepEqual(parser.push('\ude00","escaped":"\\ud800"}'), {
      text: "😀", escaped: "\ud800",
    });
  } finally {
    parser.dispose();
  }
});

test("embedded tool parsers reject unsafe paths and release their scanner", () => {
  for (const chunks of [
    ['{"__proto__":{"polluted":true}}'],
    ['{"nested":[{"constructor":', '{"prototype":{"polluted":true}}}]}'],
    ['{"nested":[{"__proto__":null}]}'],
  ]) {
    const parser = createToolInputParser();
    for (const chunk of chunks.slice(0, -1)) parser.push(chunk);
    assert.throws(() => parser.push(chunks.at(-1)), /unsafe key/);
    assert.throws(() => parser.push(""), { code: "STREAM_DISPOSED" });
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
    parser.dispose();
  }
});

test("embedded tool parsers accept harmless constructor fields and key names in strings", () => {
  const parser = createToolInputParser();
  try {
    assert.deepEqual(parser.push('{"constructor":{"name":"x"},"text":"__proto__"}'), {
      constructor: { name: "x" }, text: "__proto__",
    });
  } finally {
    parser.dispose();
  }
});

test("embedded tool parsers enforce input limits and preserve syntax failures", () => {
  for (const [options, input, code] of [
    [{}, '{"a": nope}', "INVALID_JSON"],
    [{ maxBytes: 8 }, '{"query":"too long"}', "MAX_BYTES_EXCEEDED"],
    [{ maxDepth: 1 }, '{"nested":{}}', "MAX_DEPTH_EXCEEDED"],
  ]) {
    const parser = createToolInputParser(options);
    assert.throws(() => parser.push(input), { code });
    parser.dispose();
  }
});

test("embedded tool parser disposal is idempotent and stops unfinished input", () => {
  const parser = createToolInputParser();
  parser.push('{"query":"partial');
  parser.dispose();
  parser.dispose();
  assert.throws(() => parser.push('"}'), { code: "STREAM_DISPOSED" });
});
