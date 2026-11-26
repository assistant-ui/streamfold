import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { previewToolInputs } from "./claude-agent.mjs";

const session_id = randomUUID();
const envelope = (body) => ({ uuid: randomUUID(), session_id, ...body });
const frame = (event, parent_tool_use_id = null) =>
  envelope({ type: "stream_event", event, parent_tool_use_id });
const start = (id) =>
  frame({
    type: "message_start",
    message: { id, type: "message", role: "assistant", content: [], model: "fixture" },
  });
const block = (id) =>
  frame({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id, name: "Read", input: {} },
  });
const delta = (partial_json) =>
  frame({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json },
  });
const stopBlock = frame({ type: "content_block_stop", index: 0 });
const stopMessage = frame({ type: "message_stop" });
const assistant = (id, call) =>
  envelope({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "fixture",
      content: [{ type: "tool_use", id: call, name: "Read", input: { file_path: "README.md" } }],
    },
  });
const result = envelope({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  num_turns: 2,
});

function transport(t, messages, stall = false) {
  return ({ args }) => {
    assert.ok(args.includes("--include-partial-messages"));
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./fixtures/claude-agent-cli.mjs", import.meta.url)),
        JSON.stringify(messages),
      ],
      {
        stdio: ["pipe", "pipe", "pipe", ...(stall ? ["ipc"] : [])],
      },
    );
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null && !child.killed) {
        child.kill();
        assert.fail("The query left its subprocess running.");
      }
      const [, signal] = await exited;
      if (stall) assert.ok(signal, "Expected cancellation to terminate the waiting subprocess.");
    });
    return child;
  };
}

test("query previews only top-level tool blocks across model turns", async (t) => {
  const messages = [
    start("first"),
    block("one"),
    delta('{"file_path":"READ'),
    ...[start("subagent"), block("child"), delta("{}"), stopBlock, stopMessage].map((message) => ({
      ...message,
      parent_tool_use_id: "task",
    })),
    delta('ME.md"}'),
    assistant("first", "one"),
    stopBlock,
    stopMessage,
    start("second"),
    block("two"),
    delta("{}"),
    stopBlock,
    stopMessage,
    result,
  ];
  const updates = [];
  await previewToolInputs("fixture", { spawnClaudeCodeProcess: transport(t, messages) }, (update) =>
    updates.push(update),
  );
  assert.deepEqual(
    updates.map(({ type, id }) => [type, id]),
    [
      ["start", "one"],
      ["update", "one"],
      ["update", "one"],
      ["complete", "one"],
      ["start", "two"],
      ["update", "two"],
      ["complete", "two"],
    ],
  );
  assert.deepEqual(updates[1].partialValue, { file_path: "READ" });
  assert.deepEqual(updates[3].value, { file_path: "README.md" });
  assert.deepEqual(updates.at(-1).value, {});
});

for (const [boundary, end] of [
  ["message stop", [stopMessage, result]],
  ["replacement message", [start("next"), block("two"), stopBlock, stopMessage, result]],
  ["turn result", [result]],
  ["EOF", []],
]) {
  test(`query rejects an open tool at ${boundary}, even with valid JSON`, async (t) => {
    const messages = [start("first"), block("one"), delta("{}"), ...end];
    const types = [];
    await assert.rejects(
      previewToolInputs("fixture", { spawnClaudeCodeProcess: transport(t, messages) }, ({ type }) =>
        types.push(type),
      ),
      /Missing content_block_stop for tool call one/,
    );
    assert.deepEqual(types, ["start", "update"]);
  });
}

test("caller abort closes the query with an open preview", async (t) => {
  const abortController = new AbortController();
  const messages = [start("first"), block("one"), delta('{"open":"')];
  const types = [];
  await assert.rejects(
    previewToolInputs(
      "fixture",
      {
        abortController,
        spawnClaudeCodeProcess: transport(t, messages, true),
      },
      ({ type }) => {
        types.push(type);
        if (type === "update") abortController.abort();
      },
    ),
    /abort/i,
  );
  assert.deepEqual(types, ["start", "update"]);
});

test("query preserves the SDK turn error", async (t) => {
  const failure = {
    ...result,
    subtype: "error_during_execution",
    is_error: true,
    errors: ["fixture error"],
  };
  await assert.rejects(
    previewToolInputs("fixture", { spawnClaudeCodeProcess: transport(t, [failure]) }, () =>
      assert.fail("Unexpected tool update"),
    ),
    { message: "fixture error" },
  );
});

test("EOF after the last block still requires a query result", async (t) => {
  const messages = [start("first"), block("one"), delta("{}"), stopBlock, stopMessage];
  const types = [];
  await assert.rejects(
    previewToolInputs("fixture", { spawnClaudeCodeProcess: transport(t, messages) }, ({ type }) =>
      types.push(type),
    ),
    /before its result message/,
  );
  assert.deepEqual(types, ["start", "update", "complete"]);
});
