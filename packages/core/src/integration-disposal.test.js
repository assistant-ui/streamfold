import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { assistantUI } from "./assistant-ui.js";
import { bedrock } from "./bedrock.js";
import { cohere } from "./cohere.js";
import { gemini } from "./gemini.js";
import { langchain } from "./langchain.js";
import { openAI } from "./openai.js";

const adapters = [
  [
    "assistant-ui",
    assistantUI,
    {
      type: "part-start",
      path: [],
      part: { type: "tool-call", toolCallId: "call", toolName: "weather" },
    },
    (text) => ({ type: "text-delta", path: [0], textDelta: text }),
  ],
  [
    "bedrock",
    bedrock,
    { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: "call" } } } },
    (text) => ({
      contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: text } } },
    }),
  ],
  [
    "cohere",
    cohere,
    {
      type: "tool-call-start",
      index: 0,
      delta: { message: { toolCalls: { id: "call", function: { arguments: "" } } } },
    },
    (text) => ({
      type: "tool-call-delta",
      index: 0,
      delta: { message: { toolCalls: { function: { arguments: text } } } },
    }),
  ],
  [
    "gemini",
    gemini,
    {
      event_type: "step.start",
      index: 0,
      step: { type: "function_call", id: "call", arguments: {} },
    },
    (text) => ({
      event_type: "step.delta",
      index: 0,
      delta: { type: "arguments_delta", arguments: text },
    }),
  ],
  [
    "langchain",
    langchain,
    { tool_call_chunks: [{ id: "call", index: 0, args: "" }] },
    (text) => ({ tool_call_chunks: [{ index: 0, args: text }] }),
  ],
];

function trackCollections(create) {
  const collections = [];
  const originals = { Map: globalThis.Map, Set: globalThis.Set };
  // Capture only adapter construction; parser creation and event consumption use native globals.
  for (const [name, Original] of Object.entries(originals)) {
    globalThis[name] = class extends Original {
      constructor(...args) {
        super(...args);
        collections.push(this);
      }
    };
  }
  try {
    return { integration: create(), collections };
  } finally {
    Object.assign(globalThis, originals);
  }
}

for (const [name, factory, start, delta] of adapters) {
  for (const mode of ["return", "abort", "source-error", "invalid-json", "eof"]) {
    test(`${name} releases bookkeeping after ${mode}`, async () => {
      const reason = new Error("source fixture failed");
      const controller = new AbortController();
      let retained;
      let pool;
      let closed = false;
      async function* source() {
        try {
          yield start;
          if (mode === "source-error") throw reason;
          yield delta(mode === "invalid-json" ? "{" : "{}");
        } finally {
          closed = true;
        }
      }
      const completed = [];
      const run = async () => {
        for await (const update of readStructured(source(), {
          signal: controller.signal,
          integration(givenPool, options) {
            pool = givenPool;
            retained = trackCollections(() => factory(pool, options));
            return retained.integration;
          },
        })) {
          if (update.type === "start") {
            assert.ok(retained.collections.some((collection) => collection.size > 0));
            if (mode === "return") break;
            if (mode === "abort") controller.abort(reason);
          }
          if (update.type === "complete") completed.push(update.value);
        }
      };
      if (mode === "abort" || mode === "source-error") {
        await assert.rejects(run, (error) => error === reason);
      } else if (mode === "invalid-json") {
        await assert.rejects(run, { code: "INCOMPLETE_JSON" });
      } else {
        await run();
      }
      assert.equal(closed, true);
      assert.equal(pool.size, 0);
      assert.deepEqual(completed, mode === "eof" ? [{}] : []);
      assert.ok(retained.collections.length >= 2);
      for (const collection of retained.collections) assert.equal(collection.size, 0);
    });
  }

  test(`${name} clears active bookkeeping on a direct parser failure`, () => {
    const pool = createStructuredStreamPool();
    const { integration, collections } = trackCollections(() => factory(pool));
    integration.push(start);
    assert.throws(() => integration.push(delta("]")));
    assert.equal(pool.size, 0);
    for (const collection of collections) assert.equal(collection.size, 0);
  });
}

const done = { type: "response.function_call_arguments.done", item_id: "call", arguments: "{}" };
for (const mode of ["eof", "return", "abort", "source-error"]) {
  test(`completed IDs survive active batches and are released after ${mode}`, async () => {
    const reason = new Error("completed source failed");
    const controller = new AbortController();
    let retained;
    let closed = false;
    let count = 0;
    async function* source() {
      try {
        yield done;
        yield done;
        if (mode === "source-error") throw reason;
      } finally {
        closed = true;
      }
    }
    const run = async () => {
      for await (const update of readStructured(source(), {
        signal: controller.signal,
        integration(pool) {
          retained = trackCollections(() => openAI(pool));
          return retained.integration;
        },
      })) {
        if (update.type !== "complete") continue;
        count++;
        assert.ok(retained.collections.some((collection) => collection.has("call")));
        if (mode === "return") break;
        if (mode === "abort") controller.abort(reason);
      }
    };
    if (mode === "abort" || mode === "source-error")
      await assert.rejects(run, (error) => error === reason);
    else await run();
    assert.equal(count, 1);
    assert.equal(closed, true);
    for (const collection of retained.collections) assert.equal(collection.size, 0);
  });
}

test("standalone completion history and deduplication remain available", () => {
  const integration = openAI();
  assert.equal(integration.pushAll(done).filter((update) => update.type === "complete").length, 1);
  assert.deepEqual(integration.pushAll(done), []);
  assert.deepEqual(
    integration.finish().map(({ value }) => value),
    [{}],
  );
  assert.deepEqual(
    integration.finish().map(({ value }) => value),
    [{}],
  );
});
