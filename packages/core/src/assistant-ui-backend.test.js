import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { AssistantMessageStream, unstable_toolResultStream } from "assistant-stream";
import {
  IncrementalJsonObjectParser,
  getPartialJsonObjectMeta,
  parsePartialJsonObject,
} from "assistant-stream/utils";
import { IncrementalJsonScanner } from "./index.js";
import { initializeAssistantStream } from "./assistant-ui.js";

afterEach(() => mock.restoreAll());

const track = () => ({
  push: mock.method(IncrementalJsonScanner.prototype, "push"),
  dispose: mock.method(IncrementalJsonScanner.prototype, "dispose"),
});

test("explicit initialization enables new parsers once and preserves existing native parsers", async () => {
  const existing = IncrementalJsonObjectParser.from('{"value":"');
  const { push, dispose } = track();
  assert.deepEqual(await Promise.all([initializeAssistantStream(), initializeAssistantStream()]), [
    true,
    true,
  ]);
  assert.equal(dispose.mock.callCount(), 1);
  assert.deepEqual(existing.append('native"}').currentArgs.value, "native");
  assert.equal(push.mock.callCount(), 0);
  const parser = IncrementalJsonObjectParser.from('{"value":"');
  assert.equal(parser.append('wasm"}').currentArgs.value, "wasm");
  assert.deepEqual(
    push.mock.calls.map((call) => call.arguments[0]),
    ['{"value":"', 'wasm"}'],
  );
  assert.equal(dispose.mock.callCount(), 2);
  const malformed = IncrementalJsonObjectParser.from('{"value":1');
  assert.equal(malformed.append("oops").currentArgs.value, 1);
  assert.equal(dispose.mock.callCount(), 3);
});

const inputs = [
  '{"n":2.5e+3,"m":0.25,"k":1E2}',
  '{"text":"brace } quote \\" slash \\\\ emoji 😀","nested":{"values":[1,-2.5e3,true,false,null]}}',
  '{"escaped":"line\\nfeed","unicode":"\\uD83D\\uDE00"}',
  '{"duplicate":"first","duplicate":"second","tail":0}',
  '{"constructor":1,"tail":"ok"}',
  '{"2":2,"1":1,"nested":{"10":"ten","0":"zero"}}',
  '{\n  "a" : [ 1 , { "b" : true } ] ,\n  "c" : "d"\n}\n',
  '{"tag-name":"well-known","n":-2.5e-3}',
  '{"value":01,"tail":1}',
  '{"value":1,"tail":\f2}',
  '\f{"value":1}',
  '{"value":"\\uZZ","tail":1}',
  '{"__proto__":{"polluted":true},"tail":1}',
  '{"constructor":{"prototype":{"polluted":true}},"tail":1}',
];

for (const input of inputs) {
  test(`registered backend preserves native values and metadata at every prefix: ${JSON.stringify(input)}`, async () => {
    assert.equal(await initializeAssistantStream(), true);
    let text = "";
    let expected = parsePartialJsonObject("");
    let parser = IncrementalJsonObjectParser.from("");
    for (const delta of input) {
      text += delta;
      parser = parser.append(delta);
      expected = parsePartialJsonObject(text) ?? expected;
      assert.deepEqual(parser.currentArgs, expected, text);
      assert.equal(parser.currentTextLength, text.length);
      assert.deepEqual(
        getPartialJsonObjectMeta(parser.currentArgs),
        getPartialJsonObjectMeta(expected),
      );
    }
  });
}

test("existing prefixes and chunk splits retain native parsing semantics", async () => {
  assert.equal(await initializeAssistantStream(), true);
  for (const input of inputs.slice(0, 2)) {
    let fallback = parsePartialJsonObject("");
    for (let cut = 0; cut <= input.length; cut++) {
      const prefix = input.slice(0, cut);
      fallback = parsePartialJsonObject(prefix) ?? fallback;
      const parser = IncrementalJsonObjectParser.from(prefix);
      assert.deepEqual(parser.currentArgs, fallback);
      assert.deepEqual(
        getPartialJsonObjectMeta(parser.currentArgs),
        getPartialJsonObjectMeta(fallback),
      );
      assert.deepEqual(parser.append(input.slice(cut)).currentArgs, parsePartialJsonObject(input));
    }
  }
});

test("hyphens, complete emoji, and brace-ending prefixes stay on Streamfold", async () => {
  assert.equal(await initializeAssistantStream(), true);
  const { push, dispose } = track();
  const cases = [
    [['{"tag-', 'name":"well-', 'known"}'], { "tag-name": "well-known" }],
    [['{"😀":"café ', "東京 🚀", ' is ready"}'], { "😀": "café 東京 🚀 is ready" }],
    [['{"text":"a }', ' b"}'], { text: "a } b" }],
    [['{"nested":{"value":1}', ',"tail":2}'], { nested: { value: 1 }, tail: 2 }],
  ];
  for (const [chunks, value] of cases) {
    let parser = IncrementalJsonObjectParser.from(chunks[0]);
    for (const chunk of chunks.slice(1)) parser = parser.append(chunk);
    assert.deepEqual(JSON.parse(JSON.stringify(parser.currentArgs)), value);
  }
  assert.deepEqual(
    push.mock.calls.map((call) => call.arguments[0]),
    cases.flatMap(([chunks]) => chunks),
  );
  assert.equal(dispose.mock.callCount(), cases.length);
});

test("unpaired surrogate deltas fall back without losing text or historical values", async () => {
  assert.equal(await initializeAssistantStream(), true);
  const { dispose } = track();
  for (const [delta, rest, expected] of [
    ["\uD83D", '\uDE00"}', "😀"],
    ["\uDE00", 'tail"}', "\uDE00tail"],
  ]) {
    const partial = IncrementalJsonObjectParser.from('{"value":"').append(delta);
    assert.equal(partial.currentArgs.value, delta);
    assert.equal(partial.append(rest).currentArgs.value, expected);
    assert.equal(partial.currentArgs.value, delta);
  }
  assert.equal(dispose.mock.callCount(), 2);
});

test("registered parsing preserves frozen fallbacks until an object starts", async () => {
  assert.equal(await initializeAssistantStream(), true);
  for (const frozen of [false, true]) {
    const nested = { value: 1 };
    const fallback = { nested };
    if (frozen) {
      Object.freeze(nested);
      Object.freeze(fallback);
    }
    for (const prefix of ["", " "]) {
      const parser = IncrementalJsonObjectParser.from(prefix, fallback);
      const next = parser.append(" \n");
      assert.equal(parser.currentArgs, fallback);
      assert.equal(next.currentArgs, fallback);
      assert.equal(next.append('{"ready":true}').currentArgs.ready, true);
      assert.equal(fallback.nested, nested);
    }
  }
});

test("active branches and mutable historical snapshots remain isolated", async () => {
  assert.equal(await initializeAssistantStream(), true);
  const early = IncrementalJsonObjectParser.from('{"items":[{"text":"hel');
  const left = early.append("lo");
  const right = early.append('p"}]}');
  const finishedLeft = left.append('"}]}');
  assert.equal(early.currentArgs.items[0].text, "hel");
  assert.equal(left.currentArgs.items[0].text, "hello");
  assert.equal(right.currentArgs.items[0].text, "help");
  assert.equal(finishedLeft.currentArgs.items[0].text, "hello");
  early.currentArgs.items[0].text = "caller";
  assert.equal(left.currentArgs.items[0].text, "hello");
  const nested = IncrementalJsonObjectParser.from('{"nested":{"value":1},');
  const later = nested.append(" ");
  nested.currentArgs.nested.value = 2;
  assert.equal(later.currentArgs.nested.value, 1);
  assert.equal(later.append('"tail":3}').currentArgs.nested.value, 1);
});

test("complete single-delta arguments retain the native fast path", async () => {
  assert.equal(await initializeAssistantStream(), true);
  const { push } = track();
  assert.equal(IncrementalJsonObjectParser.from('{"value":"a }"} \n').currentArgs.value, "a }");
  assert.equal(push.mock.callCount(), 0);
});

test(
  "message accumulators and active tool readers use the registered backend",
  { timeout: 3000 },
  async () => {
    assert.equal(await initializeAssistantStream(), true);
    const { push } = track();
    const chunks = [
      {
        type: "part-start",
        path: [],
        part: { type: "tool-call", toolCallId: "call", toolName: "write" },
      },
      { type: "text-delta", path: [0], textDelta: '{"value":"done",' },
      { type: "text-delta", path: [0], textDelta: '"later":"end"}' },
      { type: "tool-call-args-text-finish", path: [0] },
      { type: "part-finish", path: [0] },
    ];
    const source = () =>
      new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      });
    const message = await AssistantMessageStream.fromAssistantStream(source()).unstable_result();
    assert.deepEqual(JSON.parse(JSON.stringify(message.parts[0].args)), {
      value: "done",
      later: "end",
    });
    const reads = [];
    let resolveField;
    const fieldRead = new Promise((resolve) => {
      resolveField = resolve;
    });
    const readerSource = new ReadableStream({
      async start(controller) {
        controller.enqueue(chunks[0]);
        controller.enqueue(chunks[1]);
        await fieldRead;
        for (const chunk of chunks.slice(2)) controller.enqueue(chunk);
        controller.close();
      },
    });
    const stream = readerSource.pipeThrough(
      unstable_toolResultStream(
        {
          write: {
            parameters: { type: "object" },
            streamCall: async (reader) => {
              const value = await reader.args.get("value");
              reads.push(value);
              resolveField();
            },
          },
        },
        new AbortController().signal,
        async () => {},
      ),
    );
    await stream.pipeTo(new WritableStream());
    assert.deepEqual(reads, ["done"]);
    assert.equal(
      push.mock.calls.filter((call) => call.arguments[0] === '{"value":"done",').length,
      2,
    );
  },
);
