import assert from "node:assert/strict";
import test from "node:test";
import { parsePartialJson } from "ai";
import {
  getPartialJsonObjectFieldState,
  parsePartialJsonObject,
} from "assistant-stream/utils";
import fc from "fast-check";
import { createStructuredStream } from "../packages/core/src/index.js";

const chunkSchedule = fc.array(fc.integer({ min: 1, max: 17 }), {
  minLength: 1,
  maxLength: 32,
});

const pushWithSchedule = (stream, input, schedule, onUpdate) => {
  let offset = 0;
  let chunkIndex = 0;
  while (offset < input.length) {
    const size = schedule[chunkIndex % schedule.length];
    const chunk = input.slice(offset, offset + size);
    offset += chunk.length;
    chunkIndex++;
    const update = stream.push(chunk);
    onUpdate?.(update, input.slice(0, offset));
  }
};

const endsWithHighSurrogate = (value) => {
  const unit = value.charCodeAt(value.length - 1);
  return unit >= 0xd800 && unit <= 0xdbff;
};

const collectPaths = (value, path = [], result = [[]]) => {
  if (value === null || typeof value !== "object" || result.length >= 40) {
    return result;
  }
  const entries = Array.isArray(value)
    ? value.map((child, index) => [index, child])
    : Object.entries(value);
  for (const [key, child] of entries) {
    if (result.length >= 40) break;
    const childPath = [...path, key];
    result.push(childPath);
    collectPaths(child, childPath, result);
  }
  return result;
};

test("reconstructs generated JSON across arbitrary chunk schedules", () => {
  fc.assert(
    fc.property(fc.jsonValue(), chunkSchedule, (generated, schedule) => {
      const input = JSON.stringify(generated);
      const expected = JSON.parse(input);
      const stream = createStructuredStream();
      pushWithSchedule(stream, input, schedule);
      const update = stream.finish();

      assert.deepEqual(update.partialValue, expected);
      assert.equal(update.complete, true);
      assert.equal(update.bytesSeen, Buffer.byteLength(input));
      assert.equal(stream.getFieldState([]), "complete");
      stream.dispose();
    }),
    { numRuns: 500, seed: 0x5f01d },
  );
});

test("reconstructs generated JSON at every two-part boundary", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (generated) => {
      const input = JSON.stringify(generated);
      const expected = JSON.parse(input);

      for (let split = 0; split <= input.length; split++) {
        const stream = createStructuredStream();
        stream.push(input.slice(0, split));
        stream.push(input.slice(split));
        const update = stream.finish();
        assert.deepEqual(update.partialValue, expected, `split ${split}`);
        stream.dispose();
      }
    }),
    { numRuns: 100, seed: 0x5f02d },
  );
});

test("matches generated Vercel and assistant-stream prefixes", async () => {
  const objectValue = fc
    .jsonValue()
    .filter(
      (value) =>
        value !== null && typeof value === "object" && !Array.isArray(value),
    );

  await fc.assert(
    fc.asyncProperty(objectValue, chunkSchedule, async (generated, schedule) => {
      const input = JSON.stringify(generated);
      const paths = collectPaths(generated);
      paths.push(["missing-field"]);
      // Repair-based oracles hold positive exponents at the mantissa until the enclosing JSON closes.
      const comparePartialPrefixes = !/[eE]\+/.test(input);
      const stream = createStructuredStream();

      let offset = 0;
      let chunkIndex = 0;
      while (offset < input.length) {
        const size = schedule[chunkIndex % schedule.length];
        const chunk = input.slice(offset, offset + size);
        offset += chunk.length;
        chunkIndex++;
        const accumulated = input.slice(0, offset);
        const update = stream.push(chunk);
        if (endsWithHighSurrogate(accumulated)) continue;
        if (!comparePartialPrefixes && accumulated.length < input.length) {
          continue;
        }

        const vercel = await parsePartialJson(accumulated);
        assert.deepEqual(update.partialValue, vercel.value);

        const assistant = parsePartialJsonObject(accumulated);
        assert.notEqual(assistant, undefined);
        assert.deepEqual(
          update.partialValue,
          JSON.parse(JSON.stringify(assistant)),
        );
        if (comparePartialPrefixes) {
          for (const path of paths) {
            assert.equal(
              stream.getFieldState(path),
              getPartialJsonObjectFieldState(assistant, path),
            );
          }
        }
      }
      stream.dispose();
    }),
    { numRuns: 40, seed: 0x5f03d },
  );
});

test("rejects generated incomplete objects for arbitrary chunks", () => {
  fc.assert(
    fc.property(fc.jsonValue(), chunkSchedule, (generated, schedule) => {
      const input = JSON.stringify({ value: generated });
      const truncated = input.slice(0, -1);
      const stream = createStructuredStream();
      pushWithSchedule(stream, truncated, schedule);
      assert.throws(() => stream.finish(), SyntaxError);
      stream.dispose();
    }),
    { numRuns: 250, seed: 0x5f04d },
  );
});
