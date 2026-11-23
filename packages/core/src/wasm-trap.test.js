import assert from "node:assert/strict";
import test from "node:test";

// Each instance forwards to the real Wasm exports. When `trapNext` names an
// export, that call passes an argument the Rust ABI asserts against, so the
// real module panics and traps with `unreachable`.
const NativeInstance = WebAssembly.Instance;
let trapNext;
let instances = 0;
WebAssembly.Instance = function (module, imports) {
  instances++;
  const real = new NativeInstance(module, imports).exports;
  return {
    exports: {
      ...real,
      streamfold_parser_push: (handle, length) =>
        trapNext === "push"
          ? real.streamfold_parser_push(handle, 0xffff_ffff)
          : real.streamfold_parser_push(handle, length),
      streamfold_parser_finish: (handle) =>
        real.streamfold_parser_finish(trapNext === "finish" ? 0 : handle),
    },
  };
};

const {
  createStructuredStream,
  createStructuredStreamPool,
  isStructuredStreamError,
} = await import("./index.js");

const trapOnce = (operation, call) => {
  trapNext = operation;
  try {
    return call();
  } finally {
    trapNext = undefined;
  }
};

const assertWasmTrap = (error, operation) => {
  assert.equal(isStructuredStreamError(error), true);
  assert.equal(error.code, "WASM_TRAP");
  assert.equal(error.operation, operation);
  assert.ok(error.cause instanceof WebAssembly.RuntimeError);
  assert.match(error.message, /start a new stream/i);
  return true;
};

test("a Wasm trap during push fails closed as a structured stream error", () => {
  const scanner = createStructuredStream();
  scanner.push('{"a":');
  let trap;
  assert.throws(
    () => trapOnce("push", () => scanner.push("1}")),
    (error) => assertWasmTrap((trap = error), "push"),
  );
  assert.match(trap.message, /crashed \(unreachable\)/);
  assert.throws(() => scanner.push("1}"), (error) => error === trap);
  assert.throws(() => scanner.finish(), (error) => error === trap);
  assert.throws(() => scanner.state, (error) => error === trap);
  scanner.dispose();
});

test("a Wasm trap during finish fails closed as a structured stream error", () => {
  const scanner = createStructuredStream();
  scanner.push('{"a":1}');
  assert.throws(
    () => trapOnce("finish", () => scanner.finish()),
    (error) => assertWasmTrap(error, "finish"),
  );
  scanner.dispose();
});

test("streams sharing a trapped instance fail closed and new streams use a fresh one", () => {
  const sibling = createStructuredStream({ snapshots: "immutable" });
  sibling.push('{"b":');
  const trapped = createStructuredStream();
  trapped.push('{"a":');
  const before = instances;
  let trap;
  assert.throws(
    () => trapOnce("push", () => trapped.push("1}")),
    (error) => assertWasmTrap((trap = error), "push"),
  );

  assert.throws(
    () => sibling.push("2}"),
    (error) => {
      assertWasmTrap(error, "push");
      assert.equal(error.cause, trap.cause);
      assert.match(error.message, /another stream/);
      return true;
    },
  );
  sibling.dispose();
  trapped.dispose();

  const fresh = createStructuredStream();
  assert.equal(instances, before + 1);
  fresh.push('{"c":');
  fresh.push("[1,2]}");
  assert.deepEqual(fresh.finish().partialValue, { c: [1, 2] });
  fresh.dispose();
});

test("pools surface Wasm traps with call context and accept new calls", () => {
  const pool = createStructuredStreamPool();
  pool.start("a", '{"a":');
  assert.throws(
    () => trapOnce("push", () => pool.push("a", "1}")),
    (error) => {
      assertWasmTrap(error, "push");
      assert.equal(error.id, "a");
      return true;
    },
  );
  assert.equal(pool.has("a"), false);

  pool.start("b", '{"b":');
  pool.push("b", "true}");
  assert.deepEqual(pool.finish("b").value, { b: true });
});

test.after(() => {
  WebAssembly.Instance = NativeInstance;
});
