import assert from "node:assert/strict";
import test from "node:test";
import {
  createStructuredStream,
  createStructuredStreamPool,
  isStructuredStreamError,
} from "./index.js";
import { assistantUI } from "./assistant-ui.js";
import { vercelAI } from "./vercel-ai.js";
import { openAI } from "./openai.js";
import { langchain } from "./langchain.js";
import { gemini } from "./gemini.js";
import { anthropic } from "./anthropic.js";

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
    { code: "MISMATCHED_CLOSING", id: "b", eventType: "tool_call_chunks" },
  );
  assert.deepEqual(prior.partialValue, { name: "a" });
  assert.equal(pool.size, 0);
  assert.throws(() => stream.finish(), SyntaxError);
});

test("adapter errors carry call, event, operation and byte context and stay terminal", () => {
  const diagnostics = [];
  const pool = createStructuredStreamPool();
  const stream = vercelAI(pool, {
    onDiagnostic: (event) => diagnostics.push(event),
  });
  for (const id of ["a", "b"]) stream.pushAll({ type: "tool-input-start", id });
  stream.pushAll({ type: "tool-input-delta", id: "a", delta: '{"text":"é"}' });
  let failure;
  assert.throws(
    () => stream.pushAll({ type: "tool-input-delta", id: "a", delta: "x" }),
    (error) => {
      failure = error;
      assert.equal(error instanceof SyntaxError, true);
      assert.equal(isStructuredStreamError(error), true);
      assert.equal(error.code, "TRAILING_DATA");
      assert.equal(error.byteOffset, Buffer.byteLength('{"text":"é"}'));
      assert.equal(error.id, "a");
      assert.equal(error.operation, "push");
      assert.equal(error.adapter, "vercel-ai");
      assert.equal(error.eventType, "tool-input-delta");
      return true;
    },
  );
  assert.equal(pool.size, 0);
  assert.throws(
    () => stream.finish(),
    (error) => error === failure,
  );
  assert.throws(
    () => stream.push({}),
    (error) => error === failure,
  );
  assert.throws(
    () => stream.pushAll({}),
    (error) => error === failure,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "STREAM_ERROR");
  assert.equal(diagnostics[0].error, failure);
  assert.equal(JSON.stringify(diagnostics).includes("é"), false);
});

test("finish errors identify the incomplete call without stale event metadata", () => {
  const stream = langchain();
  stream.pushAll({ tool_call_chunks: [{ index: 0, id: "a", args: '{"a":' }] });
  assert.throws(() => stream.finish(), {
    name: "SyntaxError",
    code: "INCOMPLETE_JSON",
    id: "a",
    operation: "finish",
    adapter: "langchain",
    byteOffset: 5,
    eventType: undefined,
  });
});

test("structured errors retain their native categories", () => {
  assert.throws(() => createStructuredStream({ maxDepth: 1 }).push("[["), {
    name: "RangeError",
    code: "MAX_DEPTH_EXCEEDED",
    byteOffset: 1,
  });
  assert.throws(() => createStructuredStream({ maxBytes: 1 }).push("{}"), {
    name: "RangeError",
    code: "MAX_BYTES_EXCEEDED",
  });
  assert.throws(() => createStructuredStream().finish(), {
    name: "SyntaxError",
    code: "EMPTY_INPUT",
    byteOffset: 0,
  });
  assert.throws(() => createStructuredStream().push(undefined), {
    name: "TypeError",
    code: "INVALID_CHUNK",
  });
  const pool = createStructuredStreamPool({ maxActiveStreams: 1 });
  pool.start("a");
  assert.throws(() => pool.start("a"), { code: "DUPLICATE_STREAM", id: "a" });
  assert.throws(() => pool.start("b"), {
    name: "RangeError",
    code: "MAX_ACTIVE_STREAMS_EXCEEDED",
    id: "b",
  });
  assert.throws(() => pool.push("missing", "{}"), {
    code: "UNKNOWN_STREAM",
    id: "missing",
    operation: "push",
  });
  assert.throws(() => pool.finish("missing"), {
    code: "UNKNOWN_STREAM",
    operation: "finish",
  });
  assert.throws(() => pool.getFieldState("missing", []), {
    code: "UNKNOWN_STREAM",
    operation: "getFieldState",
  });
  pool.abort("a");
  assert.throws(() => pool.start("broken", "{]"), {
    code: "MISMATCHED_CLOSING",
    id: "broken",
    operation: "start",
  });
  assert.throws(() => pool.start("bad", null), {
    code: "INVALID_CHUNK",
    operation: "start",
  });
  assert.equal(pool.size, 0);
  const scanner = createStructuredStream();
  scanner.dispose();
  assert.throws(() => scanner.push("{}"), { code: "STREAM_DISPOSED" });
  for (const error of [null, {}, new SyntaxError(), "error"])
    assert.equal(isStructuredStreamError(error), false);
});

test("diagnostics explain unmatched tool events and no-match sessions only when opted in", () => {
  const diagnostics = [];
  const stream = anthropic(undefined, {
    onDiagnostic: (event) => diagnostics.push(event),
  });
  assert.deepEqual(
    stream.pushAll({
      type: "content_block_delta",
      index: 5,
      delta: { type: "input_json_delta", partial_json: "{}" },
    }),
    [],
  );
  assert.equal(diagnostics[0].code, "UNMATCHED_TOOL_EVENT");
  assert.equal(diagnostics[0].eventType, "content_block_delta");
  stream.finish();
  stream.finish();
  assert.deepEqual(
    diagnostics.map(({ code }) => code),
    ["UNMATCHED_TOOL_EVENT", "NO_TOOL_EVENTS"],
  );
  assert.match(diagnostics[1].message, /text-only streams are valid/);
  const emptyDiagnostics = [];
  const empty = vercelAI(undefined, {
    onDiagnostic: (event) => emptyDiagnostics.push(event),
  });
  empty.finish();
  assert.deepEqual(emptyDiagnostics, []);
});

test("normal text and repeated Vercel completion do not emit spurious diagnostics", () => {
  const diagnostics = [];
  const stream = vercelAI(undefined, {
    onDiagnostic: (event) => diagnostics.push(event),
  });
  stream.pushAll({ type: "text-delta", textDelta: "hello" });
  stream.pushAll({ type: "tool-input-start", id: "a" });
  stream.pushAll({ type: "tool-input-delta", id: "a", delta: "{}" });
  stream.pushAll({ type: "tool-input-end", id: "a" });
  assert.deepEqual(
    stream.pushAll({
      type: "tool-input-available",
      toolCallId: "a",
      input: {},
    }),
    [],
  );
  stream.finish();
  assert.deepEqual(diagnostics, []);
});

test("diagnostic callback failures never mask parser errors or prevent cleanup", () => {
  const pool = createStructuredStreamPool();
  const stream = vercelAI(pool, {
    onDiagnostic: () => {
      throw new Error("logger failed");
    },
  });
  stream.pushAll({ type: "tool-input-delta" });
  stream.pushAll({ type: "tool-input-start", id: "a" });
  assert.throws(
    () => stream.pushAll({ type: "tool-input-delta", id: "a", delta: "{]" }),
    {
      name: "SyntaxError",
      code: "MISMATCHED_CLOSING",
    },
  );
  assert.equal(pool.size, 0);
});

test("an upstream getter failure still aborts the pool and preserves frozen errors", () => {
  const pool = createStructuredStreamPool();
  const stream = vercelAI(pool);
  stream.push({ type: "tool-input-start", id: "a" });
  const failure = Object.freeze(new Error("upstream failed"));
  assert.throws(
    () =>
      stream.pushAll({
        get type() {
          throw failure;
        },
      }),
    (error) => error === failure,
  );
  assert.equal(pool.size, 0);
  assert.throws(
    () => stream.finish(),
    (error) => error === failure,
  );
});

test("adapters never log diagnostics by default", (t) => {
  const calls = [];
  for (const method of ["log", "warn", "error", "info", "debug"]) {
    t.mock.method(console, method, (...args) => calls.push(args));
  }
  const stream = vercelAI();
  stream.pushAll({ type: "tool-input-delta" });
  stream.finish();
  assert.deepEqual(calls, []);
});

test("missing IDs diagnose malformed tool events without opening anonymous calls", () => {
  const pool = createStructuredStreamPool();
  const diagnostics = [];
  const stream = openAI(pool, {
    onDiagnostic: (event) => diagnostics.push(event),
  });
  assert.deepEqual(
    stream.pushAll({
      type: "response.function_call_arguments.delta",
      delta: "{}",
    }),
    [],
  );
  assert.equal(pool.size, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "UNMATCHED_TOOL_EVENT");
  stream.finish();
  assert.equal(diagnostics[1].code, "NO_TOOL_EVENTS");
});
