import assert from "node:assert/strict";
import test from "node:test";
import {
  defineAdapter,
  IncrementalJsonScanner,
  isStructuredStreamError,
  readStructured,
} from "./index.js";
import { vercelAI } from "./vercel-ai.js";

const adapter = defineAdapter((operations) => operations);
const drain = async (source) => {
  for await (const update of source) assert.ok(update.type);
};

test("custom mapper diagnostics preserve error identity and release active calls", (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const diagnostics = [];
  const failure = new Error("mapper failed");
  const stream = defineAdapter((event) => {
    if (event.kind === "broken") throw failure;
    return event;
  })({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
  stream.pushAll([
    { type: "start", id: "a" },
    { type: "start", id: "b" },
  ]);
  assert.throws(
    () => stream.pushAll({ kind: "broken" }),
    (error) => error === failure,
  );
  assert.equal(isStructuredStreamError(failure), true);
  assert.equal(failure.code, "INTEGRATION_ERROR");
  assert.equal(failure.adapter, "custom");
  assert.equal(failure.eventType, "broken");
  assert.equal(dispose.mock.callCount(), 2);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].error, failure);
  assert.throws(
    () => stream.finish(),
    (error) => error === failure,
  );
  assert.throws(
    () => stream.pushAll([]),
    (error) => error === failure,
  );
  assert.equal(diagnostics.length, 1);
});

test("custom operation errors include call context even if diagnostics throw", () => {
  const diagnostics = [];
  const stream = adapter({
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
      throw new Error("logger failed");
    },
  });
  assert.throws(
    () =>
      stream.pushAll([
        { type: "start", id: "a" },
        { type: "delta", id: "a", text: 42 },
      ]),
    {
      name: "TypeError",
      code: "INTEGRATION_ERROR",
      id: "a",
      operation: "push",
      adapter: "custom",
      eventType: "operations",
    },
  );
  assert.equal(diagnostics.length, 1);
  assert.throws(() => stream.finish(), { code: "INTEGRATION_ERROR" });
});

test("custom no-match diagnostics happen once and never warn for unused sessions", () => {
  const diagnostics = [];
  const create = defineAdapter(() => []);
  const stream = create({
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  stream.pushAll({ kind: "text", text: "unrelated text" });
  stream.finish();
  stream.finish();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "NO_TOOL_EVENTS");
  assert.equal(diagnostics[0].adapter, "custom");
  assert.equal(JSON.stringify(diagnostics).includes("unrelated text"), false);
  create({
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  }).finish();
  assert.equal(diagnostics.length, 1);
});

test("managed custom and SDK readers forward diagnostics with immutable options", async () => {
  const cases = [
    {
      factory: { adapter },
      events: [
        [
          { type: "start", id: "a" },
          { type: "delta", id: "a", text: '{"secret":' },
        ],
      ],
      name: "custom",
    },
    {
      factory: { integration: vercelAI },
      events: [
        { type: "tool-input-start", id: "a" },
        { type: "tool-input-delta", id: "a", delta: '{"secret":' },
      ],
      name: "vercel-ai",
    },
  ];
  for (const { factory, events, name } of cases) {
    const diagnostics = [];
    let failure;
    await assert.rejects(
      drain(
        readStructured(events, {
          ...factory,
          limits: { snapshots: "immutable", maxBytes: 100 },
          onDiagnostic(diagnostic) {
            diagnostics.push(diagnostic);
            throw new Error("logger failed");
          },
        }),
      ),
      (error) => {
        failure = error;
        assert.equal(error instanceof SyntaxError, true);
        assert.equal(isStructuredStreamError(error), true);
        assert.equal(error.code, "INCOMPLETE_JSON");
        assert.equal(error.id, "a");
        assert.equal(error.operation, "finish");
        assert.equal(error.adapter, name);
        assert.equal(error.eventType, undefined);
        return true;
      },
    );
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].error, failure);
    assert.equal(JSON.stringify(diagnostics).includes("secret"), false);
  }
});

test("custom adapters preserve frozen upstream errors and ignore broken loggers", (t) => {
  const dispose = t.mock.method(IncrementalJsonScanner.prototype, "dispose");
  const failure = Object.freeze(new Error("upstream failure"));
  const stream = defineAdapter((event) => {
    if (event === null) throw failure;
    return event;
  })({
    get onDiagnostic() {
      throw new Error("logger unavailable");
    },
  });
  stream.pushAll([{ type: "start", id: "a" }]);
  assert.throws(
    () => stream.pushAll(null),
    (error) => error === failure,
  );
  assert.equal(dispose.mock.callCount(), 1);
  assert.throws(
    () => stream.finish(),
    (error) => error === failure,
  );
});
