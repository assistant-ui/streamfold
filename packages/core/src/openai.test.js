import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredStreamPool, readStructured } from "./index.js";
import { openAI } from "./openai.js";

const start = (id) => ({
  type: "response.output_item.added",
  item: { type: "function_call", id },
});
const delta = (id, text) => ({
  type: "response.function_call_arguments.delta", item_id: id, delta: text,
});
const done = (id, text) => ({
  type: "response.function_call_arguments.done", item_id: id, arguments: text,
});

test("OpenAI completion uses final arguments with missing, partial, or different deltas", () => {
  const text = '{"city":"Paris"}';
  for (const snapshots of ["live", "immutable"]) {
    for (const prefix of [undefined, "", '{"city":"Pa', '{"old":true}', text]) {
      const pool = createStructuredStreamPool({ snapshots });
      const stream = openAI(pool);
      let previous;
      if (prefix !== undefined) {
        stream.pushAll(start("a"));
        previous = stream.pushAll(delta("a", prefix))[0].partialValue;
      }
      const saved = structuredClone(previous);
      const updates = stream.pushAll(done("a", text));
      assert.deepEqual(updates.map(({ type }) => type),
        prefix === undefined ? ["start", "complete"] : ["complete"]);
      const result = updates.at(-1);
      assert.deepEqual(result.value, { city: "Paris" });
      assert.deepEqual(result.partialValue, result.value);
      assert.equal(result.text, text);
      assert.equal(result.bytesSeen, Buffer.byteLength(text));
      assert.equal(result.complete, true);
      assert.deepEqual(previous, saved);
      if (prefix === text) {
        assert.equal(result.partialValue, previous);
        assert.deepEqual(result.changes, []);
      } else if (prefix !== undefined) {
        assert.deepEqual(result.changes[0], { op: "set", path: [], value: {} });
      }
      if (snapshots === "immutable") assert.ok(Object.isFrozen(result.value));
      assert.equal(pool.size, 0);
      assert.deepEqual(stream.finish().map(({ value }) => value), [{ city: "Paris" }]);
    }
  }
});

test("OpenAI ignores duplicate completions while preserving history and explicit ID reuse", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const method of ["push", "pushAll"]) {
      const stream = openAI(createStructuredStreamPool({ snapshots }));
      stream[method](done("a", "1"));
      assert.deepEqual(stream[method](done("a", "{]")), method === "push" ? undefined : []);
      assert.deepEqual(stream.finish().map(({ value }) => value), [1]);
      stream[method](start("a"));
      stream[method](delta("a", "2"));
      stream[method](done("a", "2"));
      assert.deepEqual(stream[method](done("a", "2")), method === "push" ? undefined : []);
      assert.deepEqual(stream.finish().map(({ value }) => value), [1, 2]);
      assert.deepEqual(stream.finish().map(({ value }) => value), [1, 2]);
    }
  }
});

test("invalid OpenAI final arguments remain terminal and release all active calls", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const [limits, text, code] of [
      [{}, "{]", "MISMATCHED_CLOSING"],
      [{ maxBytes: 4 }, '"long"', "MAX_BYTES_EXCEEDED"],
      [{ maxDepth: 1 }, "[[]]", "MAX_DEPTH_EXCEEDED"],
    ]) {
      const pool = createStructuredStreamPool({ snapshots, ...limits });
      const stream = openAI(pool);
      stream.pushAll(start("a"));
      stream.pushAll(delta("a", "{}"));
      stream.pushAll(start("b"));
      let failure;
      assert.throws(() => stream.pushAll(done("a", text)), (error) => {
        failure = error;
        assert.equal(error.code, code);
        assert.equal(error.id, "a");
        assert.equal(error.operation, "finish");
        assert.equal(error.adapter, "openai");
        assert.equal(error.eventType, "response.function_call_arguments.done");
        return true;
      });
      assert.equal(pool.size, 0);
      assert.throws(() => stream.finish(), (error) => error === failure);
    }
  }
});

test("managed OpenAI completion emits final arguments once and finalizes reused IDs at EOF", async () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const prefix of [undefined, "", '{"city":"Pa', '{"city":"Paris"}']) {
      const events = [
        ...(prefix === undefined ? [] : [start("a"), delta("a", prefix)]),
        done("a", '{"city":"Paris"}'),
        done("a", '{"city":"Paris"}'),
        start("a"), delta("a", "42"),
      ];
      const values = [];
      for await (const update of readStructured(events, { integration: openAI, limits: { snapshots } }))
        if (update.type === "complete") values.push(update.value);
      assert.deepEqual(values, [{ city: "Paris" }, 42]);
    }
  }
});

test("OpenAI failure events terminate the session and release every pending call", () => {
  for (const snapshots of ["live", "immutable"]) {
    for (const method of ["push", "pushAll"]) {
      for (const [event, message, cause] of [
        [{ type: "error", message: "service failed", code: "server_error" }, "service failed"],
        [{ type: "response.failed", response: { error: { message: "service failed", code: "server_error" } } }, "service failed"],
        [{ type: "response.failed", response: { error: null } }, "OpenAI response failed"],
        ...["max_output_tokens", "max_messages", "content_filter", "unknown_reason", undefined].map((reason) => [
          { type: "response.incomplete", response: { incomplete_details: { reason } } },
          `OpenAI response incomplete${reason ? `: ${reason}` : ""}`,
          { reason },
        ]),
      ]) {
        const pool = createStructuredStreamPool({ snapshots });
        const diagnostics = [];
        const stream = openAI(pool, { onDiagnostic: (value) => diagnostics.push(value) });
        for (const id of ["a", "b"]) {
          stream[method](start(id));
          stream[method](delta(id, "{}"));
        }
        let failure;
        assert.throws(() => stream[method](event), (error) => {
          failure = error;
          assert.equal(error.code, "INTEGRATION_ERROR");
          assert.equal(error.adapter, "openai");
          assert.equal(error.eventType, event.type);
          assert.equal(error.message, message);
          assert.deepEqual(error.cause, cause ?? (event.type === "error" ? event : event.response.error));
          return true;
        });
        assert.equal(pool.size, 0);
        assert.throws(() => stream[method](done("a", "{}")), (error) => error === failure);
        assert.throws(() => stream.finish(), (error) => error === failure);
        assert.deepEqual(diagnostics.map(({ code }) => code), ["STREAM_ERROR"]);
        assert.equal(diagnostics[0].error, failure);
      }
    }
  }
});

test("OpenAI preserves upstream Error identity, including frozen errors", () => {
  for (const failure of [new Error("service failed"), Object.freeze(new Error("service failed"))]) {
    for (const event of [
      { type: "error", error: failure },
      { type: "response.failed", response: { error: failure } },
    ]) {
      const pool = createStructuredStreamPool();
      const stream = openAI(pool);
      stream.push(start("a"));
      assert.throws(() => stream.pushAll(event), (error) => error === failure);
      assert.equal(pool.size, 0);
      assert.throws(() => stream.finish(), (error) => error === failure);
    }
  }
});

test("OpenAI steering lifecycle notifications remain non-fatal", () => {
  const stream = openAI();
  stream.pushAll(done("a", "{}"));
  assert.deepEqual(stream.pushAll({
    type: "response.incomplete", response: { incomplete_details: { reason: "steered" } },
  }), []);
  assert.deepEqual(stream.pushAll({ type: "response.created" }), []);
  assert.deepEqual(stream.pushAll(done("b", "42")).map(({ type }) => type), ["start", "complete"]);
  assert.deepEqual(stream.finish().map(({ value }) => value), [{}, 42]);
});
