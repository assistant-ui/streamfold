import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStream } from "./index.js";

test("live property updates preserve identity, safe keys, and duplicate replacements", () => {
  const scanner = createStructuredStream();
  try {
    const first = scanner.push('{"__proto__":"a').partialValue;
    const second = scanner.push('b","constructor":"c').partialValue;
    assert.equal(first, second);
    assert.equal(Object.getPrototypeOf(second), Object.prototype);
    scanner.push('d","__proto__":{"ok":true},"rows":["e');
    scanner.push('f"]}');
    const expected = JSON.parse('{"__proto__":{"ok":true},"constructor":"cd","rows":["ef"]}');
    assert.deepEqual(scanner.finish().partialValue, expected);
    assert.equal(Object.getPrototypeOf(first), Object.prototype);
    assert.equal(scanner.getFieldState(["__proto__", "ok"]), "complete");
  } finally {
    scanner.dispose();
  }
});

test("live updates restore configurable data descriptors and replace accessors", () => {
  for (const attributes of [
    { writable: false },
    { enumerable: false },
    { get: () => "a", set: () => assert.fail("setter must not be called") },
  ]) {
    const scanner = createStructuredStream();
    try {
      const value = scanner.push('{"text":"a').partialValue;
      Object.defineProperty(value, "text", { configurable: true, ...attributes });
      assert.equal(scanner.push('b"}').partialValue, value);
      assert.deepEqual(Object.getOwnPropertyDescriptor(value, "text"), {
        value: "ab",
        writable: true,
        enumerable: true,
        configurable: true,
      });
      assert.deepEqual(scanner.finish().partialValue, { text: "ab" });
    } finally {
      scanner.dispose();
    }
  }
});

test("live updates still reject properties made nonconfigurable by consumers", () => {
  const scanner = createStructuredStream();
  try {
    const value = scanner.push('{"text":"a').partialValue;
    Object.defineProperty(value, "text", { configurable: false });
    assert.throws(() => scanner.push('b"}'), TypeError);
  } finally {
    scanner.dispose();
  }
});

test("new live properties bypass inherited setters", () => {
  const scanner = createStructuredStream();
  try {
    const value = scanner.push('{"first":1,').partialValue;
    const prototype = {
      set next(_) {
        assert.fail("inherited setter must not be called");
      },
    };
    Object.setPrototypeOf(value, prototype);
    scanner.push('"next":"ok"}');
    assert.equal(Object.getPrototypeOf(value), prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, "next"), {
      value: "ok",
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } finally {
    scanner.dispose();
  }
});
