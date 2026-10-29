import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, AIMessageChunk, convertToChunk } from "@langchain/core/messages";
import { readStructured } from "../packages/core/src/index.js";
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
