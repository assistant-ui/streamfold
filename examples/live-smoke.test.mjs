import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runSmoke } from "./live-smoke.mjs";

const providers = ["openai", "anthropic", "groq", "ollama"];
const endpoints = {
  openai: "https://api.openai.com/v1/responses",
  anthropic: "https://api.anthropic.com/v1/messages",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  ollama: "http://localhost:11434/v1/chat/completions",
};
const chunk = (delta, finish_reason = null) => ({
  id: "call",
  object: "chat.completion.chunk",
  model: "fixture",
  created: 1,
  choices: [{ index: 0, delta, finish_reason }],
});
function fixtures(provider, input = '{"city":"Paris"}') {
  if (provider === "openai")
    return [
      {
        type: "response.output_item.added",
        item: { type: "function_call", id: "call", name: "weather", arguments: "" },
      },
      { type: "response.function_call_arguments.delta", item_id: "call", delta: input },
      { type: "response.function_call_arguments.done", item_id: "call", arguments: input },
      { type: "response.completed", response: { status: "completed" } },
    ];
  if (provider === "anthropic")
    return [
      {
        type: "message_start",
        message: {
          id: "message",
          type: "message",
          role: "assistant",
          content: [],
          model: "fixture",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "call", name: "weather", input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: input },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      { type: "message_stop" },
    ];
  return [
    chunk({
      tool_calls: [
        { index: 0, id: "call", type: "function", function: { name: "weather", arguments: input } },
      ],
    }),
    chunk({}, "tool_calls"),
  ];
}
function sse(events) {
  return events
    .map(
      (event) => `${event.type ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
}
async function transport(t, events, status = 200) {
  const requests = [];
  const urls = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    requests.push({ headers: request.headers, body: JSON.parse(body) });
    response.writeHead(status, {
      "Content-Type": status === 200 ? "text/event-stream" : "application/json",
    });
    response.end(
      status === 200 ? sse(events) : JSON.stringify({ error: { message: "fixture failure" } }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return {
    requests,
    urls,
    fetch: async (url, options) => {
      urls.push(String(url));
      return globalThis.fetch(`http://127.0.0.1:${server.address().port}/fixture`, options);
    },
  };
}

for (const provider of providers) {
  test(`${provider} smoke uses its real SDK and bounded request through local HTTP`, async (t) => {
    const fixture = await transport(t, fixtures(provider));
    const result = await runSmoke({
      provider,
      model: "fixture",
      apiKey: "fixture-key",
      fetch: fixture.fetch,
    });
    assert.equal(result.mode, "passed");
    assert.equal(result.completedInputs, 1);
    assert.equal(result.partialUpdates, 1);
    assert.deepEqual(fixture.urls, [endpoints[provider]]);
    assert.equal(fixture.requests.length, 1);
    const { body, headers } = fixture.requests[0];
    assert.equal(body.model, "fixture");
    assert.equal(body.stream, true);
    assert.equal(body.max_output_tokens ?? body.max_tokens, 256);
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].name ?? body.tools[0].function.name, "weather");
    assert.equal(
      headers.authorization,
      `Bearer ${provider === "ollama" ? "ollama" : "fixture-key"}`,
    );
  });

  test(`${provider} smoke rejects a failure after completed arguments`, async (t) => {
    const events = fixtures(provider);
    if (provider === "openai") events.pop();
    if (provider === "anthropic") events.splice(-2);
    events.push(
      provider === "openai"
        ? { type: "response.failed", response: { error: { message: "late failure" } } }
        : { type: "error", error: { type: "api_error", message: "late failure" } },
    );
    const fixture = await transport(t, events);
    await assert.rejects(
      runSmoke({ provider, model: "fixture", apiKey: "fixture-key", fetch: fixture.fetch }),
      /late failure/,
    );
  });

  test(`${provider} smoke rejects EOF without the successful terminal event`, async (t) => {
    const fixture = await transport(t, fixtures(provider).slice(0, -1));
    await assert.rejects(
      runSmoke({ provider, model: "fixture", apiKey: "fixture-key", fetch: fixture.fetch }),
    );
  });

  test(`${provider} smoke validates completed argument values`, async (t) => {
    const fixture = await transport(t, fixtures(provider, '{"city":"Rome"}'));
    await assert.rejects(
      runSmoke({ provider, model: "fixture", apiKey: "fixture-key", fetch: fixture.fetch }),
      { code: "UNEXPECTED_INPUT" },
    );
  });

  test(`${provider} smoke does not retry a provider HTTP failure`, async (t) => {
    const fixture = await transport(t, [], 500);
    await assert.rejects(
      runSmoke({ provider, model: "fixture", apiKey: "fixture-key", fetch: fixture.fetch }),
    );
    assert.equal(fixture.requests.length, 1);
  });
}

test("text-only responses cannot pass the tool smoke", async (t) => {
  const fixture = await transport(t, [
    { type: "response.completed", response: { status: "completed" } },
  ]);
  await assert.rejects(
    runSmoke({ provider: "openai", model: "fixture", apiKey: "fixture-key", fetch: fixture.fetch }),
    { code: "INCOMPLETE_SMOKE" },
  );
});

test("multiple completed calls cannot pass the single-call smoke", async (t) => {
  const first = fixtures("groq")[0];
  const second = chunk({
    tool_calls: [
      {
        index: 1,
        id: "second",
        type: "function",
        function: { name: "weather", arguments: '{"city":"Paris"}' },
      },
    ],
  });
  const fixture = await transport(t, [first, second, chunk({}, "tool_calls")]);
  await assert.rejects(
    runSmoke({ provider: "groq", model: "fixture", apiKey: "fixture-key", fetch: fixture.fetch }),
    { code: "INCOMPLETE_SMOKE" },
  );
});

test("deadline aborts an outstanding SDK request without retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = Promise.withResolvers();
  let requests = 0;
  let requestSignal;
  const run = runSmoke({
    provider: "openai",
    model: "fixture",
    apiKey: "fixture-key",
    fetch: async (_url, options) => {
      requests++;
      requestSignal = options.signal;
      started.resolve();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        }),
      );
    },
  });
  const rejected = assert.rejects(run, { code: "TIMEOUT" });
  await started.promise;
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(requests, 1);
  assert.equal(requestSignal.aborted, true);
});

test("caller cancellation closes a pending response over real HTTP", async (t) => {
  const controller = new AbortController();
  const closed = Promise.withResolvers();
  const headersSent = Promise.withResolvers();
  const server = createServer(async (request, response) => {
    for await (const _part of request) {
      /* Drain the request before streaming. */
    }
    response.on("close", closed.resolve);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(sse(fixtures("openai").slice(0, 2)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const run = runSmoke({
    provider: "openai",
    model: "fixture",
    apiKey: "fixture-key",
    signal: controller.signal,
    fetch: async (_url, options) => {
      const response = await globalThis.fetch(
        `http://127.0.0.1:${server.address().port}/fixture`,
        options,
      );
      headersSent.resolve();
      return response;
    },
  });
  const rejected = assert.rejects(run);
  await headersSent.promise;
  controller.abort();
  await rejected;
  await closed.promise;
});

const cli = fileURLToPath(new URL("./live-smoke.mjs", import.meta.url));
function command(args, env = {}, preload = "globalThis.fetch = () => process.exit(99)") {
  return spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, cli, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "",
        OPENAI_API_KEY: "secret-openai",
        ANTHROPIC_API_KEY: "secret-anthropic",
        GROQ_API_KEY: "secret-groq",
        ...env,
      },
    },
  );
}

test("CLI defaults to a credential-free plan and never makes a request", () => {
  for (const provider of providers) {
    const result = command([provider, "fixture"]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.endpoint, endpoints[provider]);
    assert.equal(plan.apply, false);
    assert.equal(plan.requests, 1);
    assert.equal(plan.timeoutMs, 30_000);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-/);
  }
});

test("CLI rejects bad usage, missing provider credentials, and CI before fetching", () => {
  for (const [args, env, status] of [
    [[], {}, 2],
    [["__proto__", "fixture"], {}, 2],
    [["openai", "fixture", "--yes"], {}, 2],
    [["openai", "fixture", "--apply", "extra"], {}, 2],
    [["openai", "fixture", "--apply"], { OPENAI_API_KEY: "" }, 2],
    [["anthropic", "fixture", "--apply"], { ANTHROPIC_API_KEY: "" }, 2],
    [["groq", "fixture", "--apply"], { GROQ_API_KEY: "" }, 2],
    [["ollama", "fixture", "--apply"], { CI: "true" }, 3],
  ]) {
    const result = command(args, env);
    assert.equal(result.status, status, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-/);
  }
});

test("CLI does not print raw provider failures or credentials", () => {
  const result = command(
    ["openai", "fixture", "--apply"],
    { OPENAI_LOG: "debug" },
    'globalThis.fetch = async () => new Response(JSON.stringify({error:{message:"secret-openai raw-provider-body"}}),{status:400,headers:{"content-type":"application/json"}})',
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SMOKE_FAILED/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-|raw-provider-body/);
});

test("Anthropic token exhaustion cannot pass with valid completed arguments", async (t) => {
  const events = fixtures("anthropic");
  events.at(-2).delta.stop_reason = "max_tokens";
  const fixture = await transport(t, events);
  await assert.rejects(
    runSmoke({
      provider: "anthropic",
      model: "fixture",
      apiKey: "fixture-key",
      fetch: fixture.fetch,
    }),
    { code: "INCOMPLETE_SMOKE" },
  );
});

test("SIGINT cancels the CLI request and releases its deadline timer", async (t) => {
  const preload =
    'globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(options.signal.reason), {once:true}); process.stdout.write("FETCH_READY\\n"); })';
  const child = spawn(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`,
      cli,
      "openai",
      "fixture",
      "--apply",
    ],
    {
      env: { ...process.env, CI: "", OPENAI_API_KEY: "fixture-key" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const ready = Promise.withResolvers();
  let output = "";
  let errors = "";
  child.stdout.on("data", (data) => {
    output += data;
    if (output.includes("FETCH_READY")) ready.resolve();
  });
  child.stderr.on("data", (data) => {
    errors += data;
  });
  const closed = once(child, "close");
  child.once("error", ready.reject);
  child.once("close", () => ready.reject(new Error("CLI exited before requesting.")));
  await ready.promise;
  child.kill("SIGINT");
  const [code, signal] = await closed;
  assert.equal(code, 1, errors);
  assert.equal(signal, null);
  assert.doesNotMatch(output + errors, /fixture-key/);
});
