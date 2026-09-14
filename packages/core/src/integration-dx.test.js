import assert from "node:assert/strict";
import test from "node:test";
import {
  createStructuredStream,
  createStructuredStreamPool,
} from "./index.js";
import { assistantUI } from "./assistant-ui.js";
import { openAI } from "./openai.js";
import { langchain } from "./langchain.js";
import { gemini } from "./gemini.js";

test("pushAll preserves every LangChain call and repeated updates in event order", () => {
  const stream = langchain(
    createStructuredStreamPool({ snapshots: "immutable" }),
  );
  const updates = stream.pushAll({
    tool_call_chunks: [
      { index: 0, id: "a", args: '{"city":"San' },
      { index: 1, id: "b", args: '{"count":2}' },
      { index: 0, args: ' Francisco"}' },
    ],
  });
  assert.deepEqual(
    updates.map(({ type, id }) => [type, id]),
    [
      ["start", "a"],
      ["update", "a"],
      ["start", "b"],
      ["update", "b"],
      ["update", "a"],
    ],
  );
  assert.deepEqual(updates[1].partialValue, { city: "San" });
  assert.deepEqual(updates[4].partialValue, { city: "San Francisco" });
  assert.equal(updates[4].complete, true);
  assert.equal(updates[4].type, "update");
  assert.deepEqual(
    stream.finish().map(({ id, value }) => [id, value]),
    [
      ["a", { city: "San Francisco" }],
      ["b", { count: 2 }],
    ],
  );
});

test("Gemini end events expose every completed call without changing legacy push", () => {
  for (const method of ["push", "pushAll"]) {
    const stream = gemini();
    for (const index of [0, 1]) {
      stream[method]({
        event_type: "step.start",
        index,
        step: {
          type: "function_call",
          id: String(index),
          arguments: { index },
        },
      });
    }
    const end = stream[method]({ event_type: "interaction.completed" });
    if (method === "push") assert.equal(end, undefined);
    else
      assert.deepEqual(
        end.map(({ type, id, value }) => [type, id, value]),
        [
          ["complete", "0", { index: 0 }],
          ["complete", "1", { index: 1 }],
        ],
      );
    assert.equal(stream.finish().length, 2);
    assert.deepEqual(
      stream.pushAll({ event_type: "interaction.completed" }),
      [],
    );
    assert.equal(stream.finish().length, 2);
  }
});

test("OpenAI implicit starts are visible in pushAll", () => {
  const stream = openAI();
  assert.deepEqual(
    stream
      .pushAll({
        type: "response.function_call_arguments.delta",
        item_id: "a",
        delta: "{}",
      })
      .map(({ type }) => type),
    ["start", "update"],
  );
  assert.equal(
    stream.pushAll({
      type: "response.function_call_arguments.done",
      item_id: "a",
      arguments: "{}",
    })[0].type,
    "complete",
  );
  const fallback = stream.pushAll({
    type: "response.function_call_arguments.done",
    item_id: "b",
    arguments: '{"ok":true}',
  });
  assert.deepEqual(
    fallback.map(({ type }) => type),
    ["start", "complete"],
  );
  assert.deepEqual(fallback[1].value, { ok: true });
  stream.finish();
});

test("JSON completion is distinct from provider call completion", () => {
  const stream = createStructuredStream(assistantUI);
  assert.equal(
    stream.pushAll({
      type: "part-start",
      path: [0],
      part: { type: "tool-call", toolCallId: "a", toolName: "test" },
    })[0].type,
    "start",
  );
  const update = stream.pushAll({
    type: "text-delta",
    path: [0],
    textDelta: "{}",
  })[0];
  assert.equal(update.type, "update");
  assert.equal(update.complete, true);
  const final = stream.pushAll({
    type: "tool-call-args-text-finish",
    path: [0],
  })[0];
  assert.equal(final.type, "complete");
  assert.deepEqual(final.value, {});
  assert.equal(final.text, "{}");
  assert.deepEqual(
    stream.pushAll({
      type: "text-delta",
      path: [1],
      textDelta: "ordinary text",
    }),
    [],
  );
  assert.equal(stream.finish().length, 1);
});

test("legacy push still returns the last update and can alternate with pushAll", () => {
  const stream = langchain();
  const last = stream.push({
    tool_call_chunks: [
      { index: 0, id: "a", args: "{}" },
      { index: 1, id: "b", args: "{" },
    ],
  });
  assert.equal(last.id, "b");
  assert.equal(Object.hasOwn(last, "type"), false);
  assert.deepEqual(
    stream.pushAll({ tool_call_chunks: [{ index: 1, args: "}" }] })[0]
      .partialValue,
    {},
  );
  assert.equal(stream.finish().length, 2);
});

test("a failure midway through a batch throws and releases every call", () => {
  const pool = createStructuredStreamPool({ snapshots: "immutable" });
  const stream = langchain(pool);
  const prior = stream.pushAll({
    tool_call_chunks: [{ index: 0, id: "a", args: '{"name":"a' }],
  })[1];
  assert.throws(
    () =>
      stream.pushAll({
        tool_call_chunks: [
          { index: 0, args: 'b"}' },
          { index: 1, id: "b", args: "{]" },
        ],
      }),
    SyntaxError,
  );
  assert.deepEqual(prior.partialValue, { name: "a" });
  assert.equal(pool.size, 0);
  assert.throws(() => stream.finish(), SyntaxError);
});
