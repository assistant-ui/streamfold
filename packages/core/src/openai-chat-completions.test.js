import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { openAIChatCompletions } from "./openai.js";

const chunk = (tools = [], reason = null, index = 0) => ({
  choices: [{ index, delta: { tool_calls: tools }, finish_reason: reason }],
});
const start = (id, text = "", index = 0) => ({
  index,
  id,
  type: "function",
  function: { name: "weather", arguments: text },
});
const delta = (text, index = 0) => ({ index, function: { arguments: text } });

for (const snapshots of ["live", "immutable"]) {
  test(`Chat Completions preserves every interleaved ${snapshots} tool update`, () => {
    const pool = createStructuredStreamPool({ snapshots });
    const stream = openAIChatCompletions(pool);
    const first = stream.pushAll(
      chunk([start("a", '{"city":"Pa'), start("b", "[", 1)]),
    );
    assert.deepEqual(
      first.map(({ type, id }) => [type, id]),
      [
        ["start", "a"],
        ["update", "a"],
        ["start", "b"],
        ["update", "b"],
      ],
    );
    const previous = first[1].partialValue;
    stream.pushAll(chunk([start("c", "42")], null, 1));
    const updates = stream.pushAll(
      chunk([delta('ris"}'), delta("1,2]", 1)], "tool_calls"),
    );
    assert.deepEqual(
      updates.map(({ type, id }) => [type, id]),
      [
        ["update", "a"],
        ["update", "b"],
        ["complete", "a"],
        ["complete", "b"],
      ],
    );
    assert.equal(pool.size, 1);
    assert.deepEqual(
      stream.pushAll(chunk([], "stop", 1)).map(({ value }) => value),
      [42],
    );
    assert.deepEqual(
      stream.finish().map(({ id, value }) => [id, value]),
      [
        ["a", { city: "Paris" }],
        ["b", [1, 2]],
        ["c", 42],
      ],
    );
    assert.equal(pool.size, 0);
    if (snapshots === "immutable") {
      assert.deepEqual(previous, { city: "Pa" });
      assert.ok(Object.isFrozen(updates[2].value));
    }
  });

  test(`Chat Completions does not finalize ${snapshots} input at truncated EOF`, () => {
    for (const text of ["{}", '{"city":"Pa', ""]) {
      const pool = createStructuredStreamPool({ snapshots });
      const stream = openAIChatCompletions(pool);
      stream.pushAll(chunk([start("a", text)]));
      assert.throws(() => stream.finish(), /finish_reason/);
      assert.equal(pool.size, 0);
    }
  });

  test(`Chat Completions rejects failed ${snapshots} choices and releases all parsers`, () => {
    for (const reason of [
      "length",
      "content_filter",
      "function_call",
      "unknown",
    ]) {
      const pool = createStructuredStreamPool({ snapshots });
      const diagnostics = [];
      const stream = openAIChatCompletions(pool, {
        onDiagnostic: (d) => diagnostics.push(d),
      });
      stream.pushAll(chunk([start("a", "{}"), start("b", "{}", 1)]));
      let failure;
      assert.throws(
        () => stream.pushAll(chunk([], reason)),
        (error) => {
          failure = error;
          assert.equal(error.code, "INTEGRATION_ERROR");
          assert.equal(error.adapter, "openai-chat-completions");
          assert.match(error.message, new RegExp(reason));
          return true;
        },
      );
      assert.equal(pool.size, 0);
      assert.throws(
        () => stream.pushAll(chunk()),
        (error) => error === failure,
      );
      assert.throws(
        () => stream.finish(),
        (error) => error === failure,
      );
      assert.deepEqual(
        diagnostics.map(({ code }) => code),
        ["STREAM_ERROR"],
      );
    }
  });
}

test("Chat Completions ignores text, usage, and non-JSON custom tool input", () => {
  const diagnostics = [];
  const stream = openAIChatCompletions(undefined, {
    onDiagnostic: (d) => diagnostics.push(d),
  });
  for (const event of [
    {
      choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
    },
    chunk([
      { index: 0, id: "custom", type: "custom", custom: { input: "not json" } },
    ]),
    chunk([{ index: 0, custom: { input: "still not json" } }], "tool_calls"),
    { choices: [], usage: { total_tokens: 12 } },
  ])
    assert.deepEqual(stream.pushAll(event), []);
  assert.deepEqual(stream.finish(), []);
  assert.deepEqual(
    diagnostics.map(({ code }) => code),
    ["NO_TOOL_EVENTS"],
  );
});

test("Chat Completions handles multiple choices in one chunk and duplicate endings", () => {
  const stream = openAIChatCompletions();
  const events = [
    chunk([start("a", "{}")], "tool_calls"),
    chunk([start("b", "[]")], "stop", 1),
  ];
  const updates = stream.pushAll({
    choices: events.flatMap(({ choices }) => choices),
  });
  assert.deepEqual(
    updates.filter(({ type }) => type === "complete").map(({ id }) => id),
    ["a", "b"],
  );
  assert.deepEqual(stream.pushAll(chunk([], "tool_calls")), []);
  assert.deepEqual(stream.finish(), stream.finish());
  assert.equal(stream.finish().length, 2);
});

test("Chat Completions rejects ambiguous tool identities and unsupported legacy function calls", () => {
  for (const event of [
    chunk([delta("{}")]),
    chunk([start("", "{}")]),
    chunk([start("a", "{}", -1)]),
    chunk([start("a", "{}")], null, -1),
    { choices: [{ index: 0, delta: { function_call: { arguments: "{}" } } }] },
  ]) {
    const pool = createStructuredStreamPool();
    const stream = openAIChatCompletions(pool);
    assert.throws(() => stream.pushAll(event), { code: "INTEGRATION_ERROR" });
    assert.equal(pool.size, 0);
  }
  for (const event of [
    chunk([start("b")]),
    chunk([start("a", "", 1)]),
    chunk([start("a")], null, 1),
  ]) {
    const pool = createStructuredStreamPool();
    const stream = openAIChatCompletions(pool);
    stream.pushAll(chunk([start("a", "{}")]));
    assert.throws(() => stream.pushAll(event), /id/);
    assert.equal(pool.size, 0);
  }
  const stream = openAIChatCompletions();
  stream.pushAll(chunk([start("a", "{}")], "tool_calls"));
  assert.throws(() => stream.pushAll(chunk([start("b", "{}")])), /finished/);
});

test("Chat Completions keeps strict JSON and pool limits", () => {
  for (const [limits, text, code] of [
    [{}, "", "EMPTY_INPUT"],
    [{}, "{]", "MISMATCHED_CLOSING"],
    [{}, '{"city":"Pa', "INCOMPLETE_JSON"],
    [{ maxBytes: 4 }, '"long"', "MAX_BYTES_EXCEEDED"],
    [{ maxDepth: 1 }, "[[]]", "MAX_DEPTH_EXCEEDED"],
  ]) {
    const pool = createStructuredStreamPool(limits);
    const stream = openAIChatCompletions(pool);
    assert.throws(
      () => stream.pushAll(chunk([start("a", text)], "tool_calls")),
      (error) => {
        assert.equal(error.code, code);
        return true;
      },
    );
    assert.equal(pool.size, 0);
  }
});

test("Chat Completions preserves provider errors and legacy push returns the final update", () => {
  const pool = createStructuredStreamPool();
  const stream = openAIChatCompletions(pool);
  assert.deepEqual(
    stream.push(chunk([start("a", "{}")], "tool_calls")).value,
    {},
  );
  stream.push(chunk([start("b", "{")], null, 1));
  const failure = new Error("provider failed");
  assert.throws(
    () => stream.push({ error: failure }),
    (error) => error === failure,
  );
  assert.equal(pool.size, 0);
});

test("managed Chat Completions closes sources and disposes on cancellation and early return", async () => {
  for (const mode of ["normal", "break", "abort", "source-error"]) {
    const controller = new AbortController();
    const failure = new Error("source failed");
    let closed = false;
    let pool;
    async function* events() {
      try {
        yield chunk([start("a", '{"city":"Pa')]);
        if (mode === "source-error") throw failure;
        yield chunk([delta('ris"}')], "tool_calls");
        yield { choices: [] };
      } finally {
        closed = true;
      }
    }
    const completed = [];
    const run = async () => {
      for await (const update of readStructured(events(), {
        integration: (ownedPool, options) => {
          pool = ownedPool;
          return openAIChatCompletions(ownedPool, options);
        },
        signal: controller.signal,
      })) {
        if (mode === "break") break;
        if (mode === "abort") controller.abort();
        if (update.type === "complete") completed.push(update.value);
      }
    };
    if (mode === "abort") await assert.rejects(run, { name: "AbortError" });
    else if (mode === "source-error")
      await assert.rejects(run, (error) => error === failure);
    else await run();
    assert.equal(closed, true);
    assert.equal(pool.size, 0);
    assert.deepEqual(completed, mode === "normal" ? [{ city: "Paris" }] : []);
  }
});

test("Chat Completions enforces active-call limits without leaking parsers", () => {
  const pool = createStructuredStreamPool({ maxActiveStreams: 1 });
  const stream = openAIChatCompletions(pool);
  assert.throws(() => stream.pushAll(chunk([start("a"), start("b", "", 1)])), {
    code: "MAX_ACTIVE_STREAMS_EXCEEDED",
  });
  assert.equal(pool.size, 0);
});
