import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { HttpAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import { createStructuredStreamPool } from "streamfold";
import { agUI } from "streamfold/ag-ui";

const runStart = { type: EventType.RUN_STARTED, threadId: "thread", runId: "run" };
const runEnd = { type: EventType.RUN_FINISHED, threadId: "thread", runId: "run" };
const start = (toolCallId) => ({
  type: EventType.TOOL_CALL_START,
  toolCallId,
  toolCallName: "weather",
});
const args = (toolCallId, delta) => ({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta });
const end = (toolCallId) => ({ type: EventType.TOOL_CALL_END, toolCallId });

function fixtureAgent(events) {
  const body = events
    .map((event) => `data: ${JSON.stringify(EventSchemas.parse(event))}\n\n`)
    .join("");
  return new HttpAgent({
    url: "https://fixture.invalid/ag-ui",
    threadId: "thread",
    fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
  });
}

function subscriber(stream, updates, observed = [], errors = []) {
  return {
    onEvent({ event, agent }) {
      if (errors.length) return;
      observed.push(event.type);
      try {
        updates.push(...stream.pushAll(event));
      } catch (error) {
        errors.push(error);
        agent.abortRun();
      }
    },
  };
}

test("AG-UI SDK SSE events preserve interleaved IDs and immutable previews", async () => {
  const agent = fixtureAgent([
    runStart,
    start("a"),
    start("b"),
    args("a", '{"city":"San'),
    args("b", '{"city":"Paris"}'),
    args("a", ' Francisco"}'),
    end("b"),
    end("a"),
    runEnd,
  ]);
  const pool = createStructuredStreamPool({ snapshots: "immutable" });
  const stream = agUI(pool);
  const updates = [];
  await agent.runAgent({ runId: "run" }, subscriber(stream, updates));
  assert.deepEqual(
    updates.filter(({ type }) => type === "complete").map(({ id, value }) => [id, value]),
    [
      ["b", { city: "Paris" }],
      ["a", { city: "San Francisco" }],
    ],
  );
  const first = updates.find(({ type }) => type === "update");
  assert.deepEqual(first.partialValue, { city: "San" });
  assert.equal(Object.isFrozen(first.partialValue), true);
  assert.equal(pool.size, 0);
});

test("AG-UI client expands compact tool chunks before Streamfold receives them", async () => {
  const agent = fixtureAgent([
    runStart,
    {
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: "a",
      toolCallName: "weather",
      delta: '{"city":"',
    },
    { type: EventType.TOOL_CALL_CHUNK, toolCallId: "a", delta: 'Paris"}' },
    { type: EventType.TOOL_CALL_CHUNK, toolCallId: "b", toolCallName: "weather", delta: "{}" },
    runEnd,
  ]);
  const pool = createStructuredStreamPool({ snapshots: "immutable" });
  const updates = [];
  const observed = [];
  await agent.runAgent({ runId: "run" }, subscriber(agUI(pool), updates, observed));
  assert.equal(observed.includes(EventType.TOOL_CALL_CHUNK), false);
  assert.equal(observed.filter((type) => type === EventType.TOOL_CALL_END).length, 2);
  assert.deepEqual(
    updates.filter(({ type }) => type === "complete").map(({ id, value }) => [id, value]),
    [
      ["a", { city: "Paris" }],
      ["b", {}],
    ],
  );
  assert.equal(pool.size, 0);
});

test("AG-UI SDK run errors release pending parsers without fabricating completion", async () => {
  const agent = fixtureAgent([
    runStart,
    start("a"),
    args("a", '{"city":"Paris"}'),
    { type: EventType.RUN_ERROR, message: "Provider unavailable", code: "provider_error" },
  ]);
  const pool = createStructuredStreamPool();
  const stream = agUI(pool);
  const updates = [];
  const errors = [];
  await agent.runAgent({ runId: "run" }, subscriber(stream, updates, [], errors));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Provider unavailable/);
  assert.equal(errors[0].code, "INTEGRATION_ERROR");
  assert.equal(errors[0].cause.type, EventType.RUN_ERROR);
  assert.equal(pool.size, 0);
  assert.deepEqual(
    updates.filter(({ type }) => type === "complete"),
    [],
  );
  assert.throws(() => stream.finish(), /Provider unavailable/);
});

test("AG-UI SDK-delivered malformed arguments retain parser validation", async () => {
  const agent = fixtureAgent([runStart, start("a"), args("a", '{"city":'), end("a"), runEnd]);
  const pool = createStructuredStreamPool();
  const updates = [];
  const errors = [];
  await agent.runAgent({ runId: "run" }, subscriber(agUI(pool), updates, [], errors));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Incomplete JSON/);
  assert.equal(errors[0].code, "INCOMPLETE_JSON");
  assert.equal(pool.size, 0);
  assert.deepEqual(
    updates.filter(({ type }) => type === "complete"),
    [],
  );
});

test("aborting an AG-UI SDK run cancels its response body and discards pending inputs", async () => {
  const events = [runStart, start("a"), args("a", '{"city":"Pa')];
  let responseClosed;
  const closed = new Promise((resolve) => {
    responseClosed = resolve;
  });
  const server = createServer((_request, response) => {
    response.on("close", responseClosed);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const agent = new HttpAgent({
    url: `http://127.0.0.1:${server.address().port}/ag-ui`,
    threadId: "thread",
  });
  const pool = createStructuredStreamPool();
  const stream = agUI(pool);
  const updates = [];
  const errors = [];
  const handler = subscriber(stream, updates, [], errors);
  try {
    await agent.runAgent(
      { runId: "run" },
      {
        onEvent(context) {
          handler.onEvent(context);
          if (context.event.type === EventType.TOOL_CALL_ARGS) agent.abortRun();
        },
      },
    );
    await closed;
  } finally {
    for (const id of pool.activeIds) pool.abort(id);
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  assert.equal(errors.length, 1);
  assert.equal(errors[0].cause.code, "abort");
  assert.equal(pool.size, 0);
  assert.deepEqual(
    updates.filter(({ type }) => type === "complete"),
    [],
  );
});
