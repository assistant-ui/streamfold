import assert from "node:assert/strict";
import { readStructured } from "./read-structured.js";

/** Contract tests for defineAdapter-compatible factories, not legacy SDK adapters. */
export function adapterContractTests({ adapter, encode }) {
  const start = (id) => ({ type: "start", id });
  const delta = (id, text) => ({ type: "delta", id, text });
  const end = (id) => ({ type: "end", id });
  const push = (session, operations) => {
    const updates = [];
    for (const event of encode(operations)) updates.push(...session.pushAll(event));
    return updates;
  };
  const check = (name, run) => ({
    name,
    async run() {
      const session = adapter({ snapshots: "immutable" });
      try { await run(session); }
      finally { session.dispose(); }
    },
  });
  return [
    check("interleaved calls preserve lifecycle order and values", (session) => {
      const updates = push(session, [
        start("a"), start("b"), delta("a", '{"city":"San'),
        delta("b", "42"), delta("a", ' Francisco"}'), end("b"), end("a"),
      ]);
      assert.deepEqual(updates.map(({ type, id }) => [type, id]), [
        ["start", "a"], ["start", "b"], ["update", "a"], ["update", "b"],
        ["update", "a"], ["complete", "b"], ["complete", "a"],
      ]);
      assert.deepEqual(updates[2].partialValue, { city: "San" });
      assert.equal(updates[5].value, 42);
      assert.deepEqual(updates[6].value, { city: "San Francisco" });
      assert.deepEqual(session.finish(), []);
    }),
    check("immutable snapshots retain nested values across later events", (session) => {
      const first = push(session, [start("a"), delta("a", '{"items":[{"name":"A')]).at(-1);
      push(session, [delta("a", 'B"}]}'), end("a")]);
      assert.deepEqual(first.partialValue, { items: [{ name: "A" }] });
      assert.ok(Object.isFrozen(first.partialValue));
      assert.ok(Object.isFrozen(first.partialValue.items[0]));
    }),
    check("EOF finishes pending calls exactly once", (session) => {
      push(session, [start("a"), delta("a", "null"), start("b"), delta("b", "[]"), end("b")]);
      const completed = session.finish();
      assert.equal(completed.length, 1);
      assert.equal(completed[0].id, "a");
      assert.equal(completed[0].type, "complete");
      assert.equal(completed[0].value, null);
      assert.deepEqual(session.finish(), []);
    }),
    check("abort abandons incomplete JSON and allows ID reuse", (session) => {
      const updates = push(session, [
        start("a"), delta("a", "{"), { type: "abort", id: "a" },
        start("a"), delta("a", "true"), end("a"),
        start("a"), delta("a", "false"), end("a"),
      ]);
      assert.deepEqual(updates.filter(({ type }) => type === "complete").map(({ value }) => value), [true, false]);
      assert.deepEqual(session.finish(), []);
    }),
    check("malformed input fails terminally instead of emitting a completion", (session) => {
      assert.throws(() => push(session, [start("a"), delta("a", "{]")]), SyntaxError);
      assert.throws(() => session.finish());
      assert.throws(() => push(session, [start("b")]));
    }),
    check("unknown calls and duplicate starts are rejected", (session) => {
      assert.throws(() => push(session, [delta("missing", "{}")]), { code: "UNKNOWN_STREAM" });
      const other = adapter();
      try {
        assert.throws(() => push(other, [start("a"), start("a")]), { code: "DUPLICATE_STREAM" });
      } finally { other.dispose(); }
    }),
    check("sessions are isolated and dispose is idempotent", (session) => {
      push(session, [start("a"), delta("a", "{")]);
      const other = adapter();
      try {
        const updates = push(other, [start("a"), delta("a", "42"), end("a")]);
        assert.equal(updates.at(-1).value, 42);
      } finally { other.dispose(); }
      session.dispose();
      session.dispose();
      assert.throws(() => push(session, [start("b")]), { code: "STREAM_DISPOSED" });
    }),
    check("configured parser limits are forwarded", () => {
      const limited = adapter({ maxActiveStreams: 1, maxBytes: 2 });
      try {
        assert.throws(() => push(limited, [start("a"), start("b")]), { code: "MAX_ACTIVE_STREAMS_EXCEEDED" });
      } finally { limited.dispose(); }
      const bytes = adapter({ maxBytes: 2 });
      try {
        assert.throws(() => push(bytes, [start("a"), delta("a", "true")]), { code: "MAX_BYTES_EXCEEDED" });
      } finally { bytes.dispose(); }
    }),
    {
      name: "managed early exit closes the source and disposes its session",
      async run() {
        let closed = false;
        let disposed = false;
        function* source() {
          try { yield* encode([start("a"), delta("a", "{")]); }
          finally { closed = true; }
        }
        const factory = (options) => {
          const session = adapter(options);
          return {
            pushAll: (event) => session.pushAll(event),
            finish: () => session.finish(),
            dispose() { disposed = true; session.dispose(); },
          };
        };
        for await (const update of readStructured(source(), { adapter: factory })) {
          assert.equal(update.type, "start");
          break;
        }
        assert.equal(closed, true);
        assert.equal(disposed, true);
      },
    },
  ];
}
