import assert from "node:assert/strict";
import test from "node:test";
import {
  getPartialJsonObjectFieldState,
  parsePartialJsonObject,
} from "assistant-stream/utils";
import { createStructuredStream } from "../packages/core/src/index.js";

const cases = [
  ["", [], "partial"],
  ["{", [], "partial"],
  ["{}", [], "complete"],
  ["", ["test"], "partial"],
  ["{", ["test"], "partial"],
  ["{}", ["test"], "complete"],
  ['{"foo": ', ["foo"], "partial"],
  ['{"foo": "b', ["foo"], "partial"],
  ['{"foo": 123', ["foo"], "partial"],
  ['{"foo": {', ["foo"], "partial"],
  ['{"foo": [', ["foo"], "partial"],
  ['{"foo": 123,', ["foo"], "complete"],
  ['{"foo": "b"', ["foo"], "complete"],
  ['{"foo": nu', ["foo"], "complete"],
  ['{"foo": fa', ["foo"], "complete"],
  ['{"foo": tr', ["foo"], "complete"],
  ['{"foo": {}', ["foo"], "complete"],
  ['{"foo": []', ["foo"], "complete"],
  ['{"foo": [{ "bar": "abc', ["foo", "0", "bar"], "partial"],
  ['{"foo": [{ "bar": "abc"', ["foo", "0", "bar"], "complete"],
  ['{"foo": [{ "bar": 123', ["foo", "0", "bar"], "partial"],
  ['{"foo": [{ "bar": nu', ["foo", 0, "bar"], "complete"],
  ['{"bar": "hello"', ["foo"], "partial"],
  ['{"bar": "hello"}', ["foo"], "complete"],
  ['{"foo": 123', ["foo", "bar", "baz"], "partial"],
  ['{"foo": fa', ["foo", "bar", "baz"], "complete"],
  ['{"1": "value","0":"', ["0"], "partial"],
  ['{"1": "value","0":"', ["1"], "complete"],
  ['{"foo": "value", "0": "', ["0"], "partial"],
  ['{"foo": "value", "0": "', ["foo"], "complete"],
  ['{"foo": "foo","bar":"bar","foo": "', ["foo"], "partial"],
  ['{"foo": "foo","bar":"bar","foo": "', ["bar"], "complete"],
  [
    '{"foo": [1,"a",{"b":1},[],{},[1,[[2]]],{"1":1,"t":1',
    ["foo", 6, 1],
    "complete",
  ],
  [
    '{"foo": [1,"",{"b":1},[],{},[1,[[2]]],{"1":1,"t":1',
    ["foo", 6, "t"],
    "partial",
  ],
  ['{"\\"": "t', ['"'], "partial"],
  ['{"\\"": "t"', ['"'], "complete"],
  ['{"\\u25CF": "t', ["\u25cf"], "partial"],
];

for (const [index, [input, path, expectedState]] of cases.entries()) {
  test(`matches assistant-stream partial object case ${index + 1}`, () => {
    const expectedValue = parsePartialJsonObject(input);
    assert.notEqual(expectedValue, undefined);

    const stream = createStructuredStream();
    if (input.length > 0) stream.push(input);

    assert.deepEqual(
      stream.value ?? {},
      JSON.parse(JSON.stringify(expectedValue)),
    );
    assert.equal(
      stream.getFieldState(path),
      getPartialJsonObjectFieldState(expectedValue, path),
    );
    assert.equal(stream.getFieldState(path), expectedState);
    stream.dispose();
  });
}
