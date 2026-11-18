import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProviderClient, streamWeather } from "./openai-compatible.mjs";

// Synthetic fixtures exercise the documented OpenAI-compatible protocol, not live models.
const chunk = (tool_calls = [], finish_reason = null) => ({
  id: "chatcmpl_fixture",
  object: "chat.completion.chunk",
  created: 1,
  model: "fixture",
  choices: [{ index: 0, delta: { tool_calls }, finish_reason }],
});
const tool = (index, id, args) => ({
  index,
  id,
  type: "function",
  function: { name: "weather", arguments: args },
});
const fixtures = {
  ollama: [
    chunk([tool(0, "call_paris", '{"city":"Paris"}')]),
    chunk([tool(1, "call_addis", '{"city":"Addis Ababa"}')]),
    chunk([], "tool_calls"),
  ],
  groq: [
    chunk([
      tool(0, "call_paris", '{"city":"Pa'),
      tool(1, "call_addis", '{"city":"Addis'),
    ]),
    chunk([{ index: 1, function: { arguments: ' Ababa"}' } }]),
    chunk([{ index: 0, function: { arguments: 'ris"}' } }], "tool_calls"),
    {
      ...chunk(),
      choices: [],
      x_groq: { id: "request_fixture", usage: { total_tokens: 12 } },
    },
  ],
};

for (const provider of ["ollama", "groq"]) {
  for (const mode of [
    "complete",
    "length",
    "provider-error",
    "break",
    "abort",
  ]) {
    test(`${provider} fixture ${mode} through the shared OpenAI decoder`, async () => {
      let cancelled = false;
      let requested = false;
      const controller = new AbortController();
      const events =
        mode === "complete" ? fixtures[provider] : [fixtures[provider][0]];
      if (mode === "length") events.push(chunk([], "length"));
      if (mode === "provider-error")
        events.push({
          error: { message: "provider fixture failed", type: "server_error" },
        });
      const bytes = new TextEncoder().encode(
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
          (mode === "complete" ? "data: [DONE]\n\n" : ""),
      );
      const body = new ReadableStream({
        start(sink) {
          for (let i = 0; i < bytes.length; i += 11)
            sink.enqueue(bytes.slice(i, i + 11));
          if (mode === "complete") sink.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      const client = createProviderClient(provider, {
        apiKey: "fixture-key",
        fetch: async (url, options) => {
          requested = true;
          assert.equal(
            String(url),
            provider === "ollama"
              ? "http://localhost:11434/v1/chat/completions"
              : "https://api.groq.com/openai/v1/chat/completions",
          );
          assert.equal(
            new Headers(options.headers).get("Authorization"),
            provider === "ollama" ? "Bearer ollama" : "Bearer fixture-key",
          );
          const request = JSON.parse(options.body);
          assert.equal(request.model, "fixture");
          assert.equal(request.stream, true);
          assert.equal(request.tools[0].function.name, "weather");
          assert.equal(request.n, undefined);
          return new Response(body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });
      const completed = [];
      const run = async () => {
        for await (const update of streamWeather(client, "fixture", {
          signal: controller.signal,
        })) {
          if (mode === "break") break;
          if (mode === "abort") controller.abort();
          if (update.type === "complete") {
            assert.ok(Object.isFrozen(update.value));
            completed.push([update.id, update.value]);
          }
        }
      };
      if (mode === "length") await assert.rejects(run, /finish_reason length/);
      else if (mode === "provider-error")
        await assert.rejects(run, /provider fixture failed/);
      else if (mode === "abort")
        await assert.rejects(run, { name: "AbortError" });
      else await run();
      assert.equal(requested, true);
      assert.deepEqual(
        completed,
        mode === "complete"
          ? [
              ["call_paris", { city: "Paris" }],
              ["call_addis", { city: "Addis Ababa" }],
            ]
          : [],
      );
      if (mode !== "complete") assert.equal(cancelled, true);
    });
  }
}

test("compatible-provider CLI rejects missing model and Groq credentials before requests", () => {
  for (const [args, status, message] of [
    [[], 2, /Usage:/],
    [["ollama"], 2, /Usage:/],
    [["unknown", "fixture"], 2, /Usage:/],
    [["groq", "fixture"], 1, /GROQ_API_KEY/],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./openai-compatible.mjs", import.meta.url)),
        ...args,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GROQ_API_KEY: "",
          OPENAI_API_KEY: "must-not-be-used",
        },
      },
    );
    assert.equal(result.status, status);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /must-not-be-used/);
  }
});
