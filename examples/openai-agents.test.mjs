import assert from "node:assert/strict";
import test from "node:test";
import {
  Agent,
  OpenAIChatCompletionsModel,
  OpenAIResponsesModel,
  Runner,
  tool,
} from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { readStructured } from "streamfold";
import { openAIAgents } from "streamfold/openai-agents";
import { previewWeather } from "./openai-agents.mjs";

const runner = new Runner({ tracingDisabled: true });
const weather = tool({
  name: "weather",
  description: "Return the weather.",
  parameters: z.object({ city: z.string() }),
  execute: ({ city }) => `Sunny in ${city}`,
});

function sse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

function chatChunks(id, name, first, last) {
  const choice = (delta, finish_reason = null) => ({
    id: `cmpl-${id}`,
    object: "chat.completion.chunk",
    model: "fixture",
    created: 1,
    choices: [{ index: 0, delta, finish_reason }],
  });
  return [
    choice({
      role: "assistant",
      tool_calls: [{ index: 0, type: "function", id, function: { name, arguments: first } }],
    }),
    choice({ tool_calls: [{ index: 0, function: { arguments: last } }] }),
    choice({}, "tool_calls"),
  ];
}

function responsesEvents(id) {
  const item = {
    id,
    type: "function_call",
    call_id: "call-weather",
    name: "weather",
    arguments: "",
  };
  const args = '{"city":"Paris"}';
  return [
    { type: "response.created", response: { id: "resp-weather" } },
    { type: "response.output_item.added", output_index: 0, item },
    {
      type: "response.function_call_arguments.delta",
      item_id: id,
      output_index: 0,
      delta: '{"city":"Pa',
    },
    {
      type: "response.function_call_arguments.done",
      item_id: id,
      output_index: 0,
      arguments: args,
    },
    {
      type: "response.completed",
      response: {
        id: "resp-weather",
        status: "completed",
        output: [{ ...item, arguments: args, status: "completed" }],
      },
    },
  ];
}

function client(fetch) {
  return new OpenAI({
    apiKey: "offline-fixture",
    baseURL: "https://fixture.invalid/v1",
    fetch,
    maxRetries: 0,
  });
}

const options = { integration: openAIAgents, limits: { snapshots: "immutable" } };

for (const protocol of ["Chat Completions", "Responses"]) {
  test(`Runner ${protocol} emits one partial argument and the authoritative result`, async () => {
    const chat = protocol === "Chat Completions";
    const events = chat
      ? chatChunks("call-weather", "weather", '{"city":"Pa', 'ris"}')
      : responsesEvents("fc-weather");
    const Model = chat ? OpenAIChatCompletionsModel : OpenAIResponsesModel;
    const updates = [];
    const finalOutput = await previewWeather(
      new Model(
        client(async () => sse(events)),
        "fixture",
      ),
      new AbortController().signal,
      (update) => updates.push(update),
    );
    assert.deepEqual(
      updates.map((u) => u.type),
      chat ? ["start", "update", "update", "complete"] : ["start", "update", "complete"],
    );
    assert.deepEqual(updates[1].partialValue, { city: "Pa" });
    assert.equal(updates.at(-1).id, chat ? "call-weather" : "fc-weather");
    assert.deepEqual(updates.at(-1).value, { city: "Paris" });
    assert.equal(finalOutput, "Sunny in Paris");
  });
}

test("Chat Runner reuses choice and tool index zero across an agent handoff", async () => {
  const turns = [
    chatChunks("call-handoff", "transfer_to_Weather", "{", "}"),
    chatChunks("call-weather", "weather", '{"city":"Pa', 'ris"}'),
  ];
  const model = new OpenAIChatCompletionsModel(
    client(async () => sse(turns.shift())),
    "fixture",
  );
  const specialist = new Agent({
    name: "Weather",
    model,
    tools: [weather],
    toolUseBehavior: "stop_on_first_tool",
  });
  const agent = Agent.create({ name: "Router", model, handoffs: [specialist] });
  const run = await runner.run(agent, "Weather?", { stream: true });
  const complete = (await Array.fromAsync(readStructured(run, options))).filter(
    (u) => u.type === "complete",
  );
  assert.deepEqual(
    complete.map(({ id, value }) => [id, value]),
    [
      ["call-handoff", {}],
      ["call-weather", { city: "Paris" }],
    ],
  );
  await run.completed;
  assert.equal(run.lastAgent, specialist);
  assert.equal(run.finalOutput, "Sunny in Paris");
});

test("Runner failure reaches the reader and run.completed", async () => {
  const model = new OpenAIResponsesModel(
    client(async () => new Response("unavailable", { status: 503 })),
    "fixture",
  );
  const run = await runner.run(new Agent({ name: "Weather", model }), "Weather?", { stream: true });
  await Promise.all([
    assert.rejects(Array.fromAsync(readStructured(run, options)), /503/),
    assert.rejects(run.completed, /503/),
  ]);
});

test("aborting a pending Runner request stops the reader and transport", async () => {
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const model = new OpenAIChatCompletionsModel(
    client(async (_url, { signal }) => {
      started.resolve(signal);
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    }),
    "fixture",
  );
  const run = await runner.run(new Agent({ name: "Weather", model }), "Weather?", {
    stream: true,
    signal: controller.signal,
  });
  const read = Array.fromAsync(readStructured(run, { ...options, signal: controller.signal }));
  const transport = await started.promise;
  const reason = new Error("cancel preview");
  controller.abort(reason);
  await assert.rejects(read, (error) => error === reason);
  await assert.rejects(run.completed, { cause: reason });
  assert.equal(run.cancelled, true);
  assert.equal(transport.aborted, true);
});

test("unrelated Runner events and untagged model payloads produce no updates", () => {
  const stream = openAIAgents();
  const event = chatChunks("ignored", "weather", "{}", "")[0];
  for (const envelope of [
    { type: "run_item_stream_event", item: event },
    { type: "agent_updated_stream_event" },
    { type: "raw_model_stream_event", data: { type: "model", event }, source: "custom" },
    { type: "raw_model_stream_event", data: { type: "model", event } },
    { type: "raw_model_stream_event", data: { type: "output_text_delta", delta: "{}" } },
  ])
    assert.deepEqual(stream.pushAll(envelope), []);
  assert.deepEqual(stream.finish(), []);
});

test("Runner failure after partial input discards the active call", async () => {
  const frames = chatChunks("call-weather", "weather", '{"city":"Pa', 'ris"}');
  frames.at(-1).choices[0].finish_reason = "length";
  const model = new OpenAIChatCompletionsModel(
    client(async () => sse(frames)),
    "fixture",
  );
  const run = await runner.run(
    new Agent({ name: "Weather", model, tools: [weather] }),
    "Weather?",
    { stream: true },
  );
  const updates = [];
  await assert.rejects(async () => {
    for await (const update of readStructured(run, options)) updates.push(update);
  }, /length|truncat/i);
  assert.deepEqual(
    updates.filter((update) => update.type === "complete"),
    [],
  );
  assert.deepEqual(updates[1]?.partialValue, { city: "Pa" });
});

test("Responses turn boundary finalizes pending input before the next model turn", () => {
  const stream = openAIAgents();
  const raw = (event) => ({
    type: "raw_model_stream_event",
    source: "openai-responses",
    data: { type: "model", event },
  });
  for (const id of ["first", "second"]) {
    stream.pushAll(
      raw({ type: "response.function_call_arguments.delta", item_id: id, delta: "{}" }),
    );
    const updates = stream.pushAll({
      type: "raw_model_stream_event",
      data: { type: "response_done" },
    });
    assert.deepEqual(
      updates.map(({ type, id, value }) => [type, id, value]),
      [["complete", id, {}]],
    );
  }
  assert.deepEqual(
    stream.finish().map(({ id }) => id),
    ["first", "second"],
  );
});

test("a text-only Runner result is available without argument updates", async () => {
  const chunk = {
    id: "cmpl-text",
    object: "chat.completion.chunk",
    model: "fixture",
    created: 1,
    choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
  };
  const model = new OpenAIChatCompletionsModel(
    client(async () => sse([chunk])),
    "fixture",
  );
  const run = await runner.run(new Agent({ name: "Greeter", model }), "Hello", { stream: true });
  assert.deepEqual(await Array.fromAsync(readStructured(run, options)), []);
  await run.completed;
  assert.equal(run.finalOutput, "Hello");
});
