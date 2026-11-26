import assert from "node:assert/strict";
import test from "node:test";
import { chat } from "@tanstack/ai";
import { call, fixtureAdapter, frame, sse, weatherChat } from "./fixture.mjs";
import { readToolInputs } from "./read-tool-inputs.mjs";

function read(adapter, abortController = new AbortController()) {
  return readToolInputs(chat({ ...weatherChat, adapter, abortController }), abortController);
}

test("chat streams interleaved previews and final arguments by call ID", async () => {
  const updates = await Array.fromAsync(read(fixtureAdapter()));
  assert.deepEqual(
    updates.map(({ type, id, partialValue, value }) => [
      type,
      id,
      type === "complete" ? value : partialValue,
    ]),
    [
      ["start", "west", undefined],
      ["update", "west", { city: "San" }],
      ["start", "east", undefined],
      ["update", "east", { city: "New" }],
      ["update", "west", { city: "San Francisco" }],
      ["update", "east", { city: "New York" }],
      ["complete", "west", { city: "San Francisco" }],
      ["complete", "east", { city: "New York" }],
    ],
  );
});

test("a tool can complete before chat reports a truncated model response", async () => {
  const adapter = fixtureAdapter(async () => sse(frame(call(0, "west", '{"city":"Paris"}'))));
  const completed = [];
  await assert.rejects(
    async () => {
      for await (const update of read(adapter)) {
        if (update.type === "complete") completed.push(update.value);
      }
    },
    (error) => {
      assert.equal(error.cause.type, "RUN_ERROR");
      assert.match(error.message, /finish_reason/);
      return true;
    },
  );
  assert.deepEqual(completed, [{ city: "Paris" }]);
});

test("malformed final arguments fail without completing the pending call", async () => {
  const adapter = fixtureAdapter(async () =>
    sse(frame(call(0, "west", '{"city":')) + frame({}, "tool_calls") + "data: [DONE]\n\n"),
  );
  const types = [];
  await assert.rejects(
    async () => {
      for await (const update of read(adapter)) types.push(update.type);
    },
    { code: "INCOMPLETE_JSON" },
  );
  assert.deepEqual(types, ["start", "update"]);
});

test("aborting a pending read reaches the model request", { timeout: 5000 }, async () => {
  const abortController = new AbortController();
  let transportSignal;
  const adapter = fixtureAdapter(async (_url, { signal }) => {
    transportSignal = signal;
    return sse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame(call(0, "west", '{"city":"San'))));
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      }),
    );
  });
  const reader = read(adapter, abortController);
  assert.equal((await reader.next()).value.type, "start");
  assert.deepEqual((await reader.next()).value.partialValue, { city: "San" });
  const next = reader.next();
  const reason = new Error("cancel weather lookup");
  abortController.abort(reason);
  await assert.rejects(next, (error) => error === reason);
  assert.equal(transportSignal.aborted, true);
  assert.equal((await reader.next()).done, true);
});

test("leaving after a partial aborts the run", async () => {
  const abortController = new AbortController();
  for await (const update of read(fixtureAdapter(), abortController)) {
    if (update.type === "update") break;
  }
  assert.equal(abortController.signal.aborted, true);
});
