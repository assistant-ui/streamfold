import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, AIMessageChunk, convertToChunk } from "@langchain/core/messages";
import { createStructuredStreamPool, readStructured } from "../packages/core/src/index.js";
import { langchain } from "../packages/core/src/langchain.js";

test("keeps SDK tool calls without indexes separate", async () => {
  const chunk = convertToChunk(new AIMessage({
    content: "",
    tool_calls: [
      { id: "paris", name: "weather", args: { city: "Paris" } },
      { id: "tokyo", name: "weather", args: { city: "Tokyo" } },
    ],
  }));
  const completed = [];
  for await (const update of readStructured([chunk], { integration: langchain })) {
    if (update.type === "complete") completed.push({ id: update.id, value: update.value });
  }
  assert.deepEqual(completed, [
    { id: "paris", value: { city: "Paris" } },
    { id: "tokyo", value: { city: "Tokyo" } },
  ]);
});

test("routes unindexed fragments by ID without claiming unidentified fragments", () => {
  const diagnostics = [];
  const stream = langchain(undefined, { onDiagnostic: (event) => diagnostics.push(event) });
  const updates = stream.pushAll(new AIMessageChunk({
    content: "",
    tool_call_chunks: [
      { id: "paris", args: '{"city":"Pa' },
      { id: "tokyo", args: '{"city":"To' },
      { args: "unidentified" },
      { id: "paris", args: 'ris"}' },
      { id: "tokyo", args: 'kyo"}' },
    ],
  }));
  assert.deepEqual(updates.map(({ type, id }) => [type, id]), [
    ["start", "paris"], ["update", "paris"],
    ["start", "tokyo"], ["update", "tokyo"],
    ["update", "paris"], ["update", "tokyo"],
  ]);
  assert.deepEqual(diagnostics.map(({ code }) => code), ["UNMATCHED_TOOL_EVENT"]);
  assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), [
    { id: "paris", value: { city: "Paris" } },
    { id: "tokyo", value: { city: "Tokyo" } },
  ]);
});

for (const indexed of [false, true]) {
  test(`LangChain SDK ${indexed ? "indexed" : "unindexed"} empty arguments complete as objects`, async () => {
    for (const args of [undefined, "", " \n\t"]) {
      const chunk = new AIMessageChunk({
        content: "",
        tool_call_chunks: [{
          id: "weather", name: "weather",
          ...(indexed ? { index: 0 } : {}),
          ...(args !== undefined ? { args } : {}),
        }],
      });
      assert.deepEqual(chunk.tool_calls.map(({ id, args }) => ({ id, args })), [
        { id: "weather", args: {} },
      ]);
      assert.deepEqual(chunk.invalid_tool_calls, []);
      const completed = [];
      for await (const update of readStructured([chunk], { integration: langchain })) {
        if (update.type === "complete") completed.push({ id: update.id, value: update.value });
      }
      assert.deepEqual(completed, [{ id: "weather", value: {} }]);
    }
  });
}

const toolCalls = (message) => {
  assert.deepEqual(message.invalid_tool_calls, []);
  return message.tool_calls.map(({ id, args }) => ({ id, value: args }));
};

test("starts a new call when a new ID reuses an index, as LangChain concat does", () => {
  const chunks = [
    new AIMessageChunk({
      content: "",
      tool_call_chunks: [{ index: 0, id: "call_1", name: "first", args: '{"x":1}' }],
    }),
    new AIMessageChunk({
      content: "",
      tool_call_chunks: [{ index: 0, id: "call_2", name: "second", args: '{"y":2}' }],
    }),
  ];
  const expected = toolCalls(chunks[0].concat(chunks[1]));
  assert.deepEqual(expected, [
    { id: "call_1", value: { x: 1 } },
    { id: "call_2", value: { y: 2 } },
  ]);

  const stream = langchain();
  const updates = chunks.flatMap((chunk) => stream.pushAll(chunk));
  assert.deepEqual(updates.map(({ type, id }) => [type, id]), [
    ["start", "call_1"], ["update", "call_1"],
    ["complete", "call_1"], ["start", "call_2"], ["update", "call_2"],
  ]);
  assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), expected);
});

test("routes fragments without IDs to the latest call at their index across model turns", () => {
  const turns = [
    [
      { index: 0, id: "call_1", name: "first", args: "" },
      { index: 0, args: '{"x":' },
      { index: 0, args: "1}" },
    ],
    [
      { index: 0, id: "call_2", name: "second", args: "" },
      { index: 0, args: '{"y":' },
      { index: 0, args: "2}" },
    ],
  ].map((turn) => turn.map((part) => new AIMessageChunk({ content: "", tool_call_chunks: [part] })));
  const expected = turns.flatMap((turn) =>
    toolCalls(turn.reduce((message, chunk) => message.concat(chunk))),
  );
  assert.deepEqual(expected, [
    { id: "call_1", value: { x: 1 } },
    { id: "call_2", value: { y: 2 } },
  ]);

  const stream = langchain();
  for (const chunk of turns.flat()) stream.push(chunk);
  assert.deepEqual(stream.finish().map(({ id, value }) => ({ id, value })), expected);
});

test("reports an incomplete call against its own ID when a new ID takes its index", () => {
  const pool = createStructuredStreamPool();
  const stream = langchain(pool);
  stream.push(new AIMessageChunk({
    content: "",
    tool_call_chunks: [{ index: 0, id: "call_1", name: "first", args: '{"x":' }],
  }));
  assert.throws(
    () => stream.push(new AIMessageChunk({
      content: "",
      tool_call_chunks: [{ index: 0, id: "call_2", name: "second", args: '{"y":2}' }],
    })),
    { code: "INCOMPLETE_JSON", id: "call_1", adapter: "langchain" },
  );
  assert.equal(pool.size, 0);
});
