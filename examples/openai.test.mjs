import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import OpenAI from "openai";
import { readToolInputs } from "./openai.mjs";

const exec = promisify(execFile);
const example = fileURLToPath(new URL("./openai.mjs", import.meta.url));
const item = (id) => ({
  type: "function_call",
  id,
  call_id: `call-${id}`,
  name: "weather",
  arguments: "",
  status: "in_progress",
});
const start = (id, output_index = 0) => ({
  type: "response.output_item.added",
  output_index,
  item: item(id),
});
const delta = (id, text, output_index = 0) => ({
  type: "response.function_call_arguments.delta",
  item_id: id,
  output_index,
  delta: text,
});
const done = (id, text, output_index = 0) => ({
  type: "response.function_call_arguments.done",
  item_id: id,
  output_index,
  name: "weather",
  arguments: text,
});
const events = [
  start("a"),
  start("b", 1),
  {
    type: "response.output_text.delta",
    item_id: "message",
    output_index: 2,
    content_index: 0,
    delta: "Ignored text",
  },
  delta("a", '{"city":"San'),
  delta("b", '{"city":"Paris"}', 1),
  delta("a", ' Francisco"}'),
  done("b", '{"city":"Paris"}', 1),
  done("a", '{"city":"San Francisco"}'),
];

function sse(events) {
  return events
    .map(
      (event, sequence_number) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
    )
    .join("");
}

async function createStream(events, { open = false, signal } = {}) {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      const bytes = new TextEncoder().encode(sse(events));
      for (let offset = 0; offset < bytes.length; offset += 17) {
        controller.enqueue(bytes.slice(offset, offset + 17));
      }
      if (!open) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = new OpenAI({
    apiKey: "test-key",
    fetch: async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
  });
  const source = await client.responses.create(
    {
      model: "test-model",
      input: "Weather?",
      stream: true,
    },
    { signal },
  );
  return { source, isCancelled: () => cancelled };
}

async function collect(source, options) {
  const updates = [];
  for await (const update of readToolInputs(source, options)) updates.push(update);
  return updates;
}

test("OpenAI example preserves interleaved item IDs and immutable previews through the SDK decoder", async () => {
  const { source } = await createStream(events);
  const updates = await collect(source);
  assert.deepEqual(
    updates.map(({ type, id }) => [type, id]),
    [
      ["start", "a"],
      ["start", "b"],
      ["update", "a"],
      ["update", "b"],
      ["update", "a"],
      ["complete", "b"],
      ["complete", "a"],
    ],
  );
  assert.deepEqual(updates[2].partialValue, { city: "San" });
  assert.ok(Object.isFrozen(updates[2].partialValue));
  assert.deepEqual(
    updates.slice(-2).map(({ value }) => value),
    [{ city: "Paris" }, { city: "San Francisco" }],
  );
});

test("OpenAI example accepts final arguments without preceding deltas", async () => {
  const { source } = await createStream([start("a"), done("a", '{"city":"Montréal"}')]);
  assert.deepEqual((await collect(source)).at(-1).value, { city: "Montréal" });
});

test("OpenAI example rejects truncated final JSON and closes the SDK response body", async () => {
  const { source, isCancelled } = await createStream(
    [start("a"), delta("a", '{"city":'), done("a", '{"city":')],
    { open: true },
  );
  await assert.rejects(() => collect(source), { code: "INCOMPLETE_JSON" });
  assert.equal(isCancelled(), true);
});

for (const status of ["failed", "incomplete"]) {
  test(`OpenAI example surfaces response.${status} without completing pending calls`, async () => {
    const { source, isCancelled } = await createStream(
      [
        start("a"),
        delta("a", '{"city":"Paris"}'),
        {
          type: `response.${status}`,
          response: {
            status,
            error:
              status === "failed"
                ? { code: "server_error", message: "provider disconnected" }
                : null,
            incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
          },
        },
      ],
      { open: true },
    );
    const updates = [];
    await assert.rejects(
      async () => {
        for await (const update of readToolInputs(source)) updates.push(update);
      },
      { code: "INTEGRATION_ERROR", eventType: `response.${status}` },
    );
    assert.deepEqual(
      updates.map(({ type }) => type),
      ["start", "update"],
    );
    assert.equal(isCancelled(), true);
  });
}

test("breaking the OpenAI example loop cancels the SDK response body", async () => {
  const { source, isCancelled } = await createStream(events, { open: true });
  for await (const update of readToolInputs(source)) {
    if (update.type === "update") break;
  }
  assert.equal(isCancelled(), true);
  assert.equal(source.controller.signal.aborted, true);
});

test("the shared signal aborts a pending OpenAI read and cancels its response body", async () => {
  const controller = new AbortController();
  const { source, isCancelled } = await createStream([start("a")], {
    open: true,
    signal: controller.signal,
  });
  const iterator = readToolInputs(source, { signal: controller.signal });
  try {
    assert.equal((await iterator.next()).value.type, "start");
    const pending = iterator.next();
    const reason = new Error("stop preview");
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
  } finally {
    await iterator.return();
  }
  assert.equal(isCancelled(), true);
  assert.equal(source.controller.signal.aborted, true);
});

test("the executable OpenAI example sends the documented tool and prints parsed arguments", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      url: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(sse(events));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { stdout, stderr } = await exec(process.execPath, [example], {
      env: {
        ...process.env,
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "test-model",
        OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
      },
    });
    assert.equal(stderr, "");
    assert.equal(requests.length, 1);
    const [{ method, url, body }] = requests;
    assert.equal(method, "POST");
    assert.equal(url, "/v1/responses");
    assert.equal(body.model, "test-model");
    assert.equal(body.stream, true);
    assert.deepEqual(body.tool_choice, { type: "function", name: "weather" });
    assert.equal(body.tools[0].strict, true);
    assert.deepEqual(body.tools[0].parameters, {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    });
    const updates = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(updates.at(-1), {
      type: "complete",
      id: "a",
      value: { city: "San Francisco" },
    });
    assert.deepEqual(updates[2].value, { city: "San" });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("the executable OpenAI example explains missing model configuration", async () => {
  await assert.rejects(
    exec(process.execPath, [example], {
      env: { ...process.env, OPENAI_MODEL: "", OPENAI_API_KEY: "test-key" },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /Set `OPENAI_MODEL` to a Responses API model that supports function calling/,
      );
      return true;
    },
  );
});
