import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

// A context created with `codeGeneration: { wasm: false }` refuses to compile
// Wasm from bytes, the way edge isolates and strict CSP pages do. Its
// WebAssembly namespace stands in for the global until the last test. Each test
// file runs in its own process, so the module cache starts empty here.
const NativeWebAssembly = globalThis.WebAssembly;
const BlockedWebAssembly = vm.runInContext(
  "WebAssembly",
  vm.createContext({}, { codeGeneration: { wasm: false } }),
);
globalThis.WebAssembly = BlockedWebAssembly;

const {
  createStructuredStream,
  createStructuredStreamPool,
  defineAdapter,
  isStructuredStreamError,
  prepareStreamfold,
  readStructured,
} = await import("./index.js");
const { openAI } = await import("./openai.js");

const assertCompileBlocked = (error) => {
  assert.equal(isStructuredStreamError(error), true);
  assert.equal(error.code, "WASM_COMPILE_BLOCKED");
  assert.ok(error.cause instanceof BlockedWebAssembly.CompileError);
  assert.match(error.message, /disallowed by embedder/);
  assert.match(error.message, /'wasm-unsafe-eval'/);
  assert.match(error.message, /Node\.js/);
  return true;
};

const drain = async (updates) => {
  for await (const _ of updates);
};

test("a blocked compile fails scanner creation with WASM_COMPILE_BLOCKED", () => {
  assert.throws(() => createStructuredStream(), assertCompileBlocked);
});

test("a blocked compile rejects prepareStreamfold with WASM_COMPILE_BLOCKED", async () => {
  await assert.rejects(prepareStreamfold(), assertCompileBlocked);
});

test("a blocked compile fails pool starts with WASM_COMPILE_BLOCKED", () => {
  const pool = createStructuredStreamPool();
  assert.throws(() => pool.start("a", "{"), assertCompileBlocked);
  assert.equal(pool.has("a"), false);
});

test("readStructured reports a blocked compile instead of INTEGRATION_ERROR", async () => {
  const adapter = defineAdapter((operations) => operations);
  await assert.rejects(
    drain(readStructured([[{ type: "start", id: "a" }]], { adapter })),
    (error) => {
      assertCompileBlocked(error);
      assert.equal(error.adapter, "custom");
      return true;
    },
  );
  await assert.rejects(
    drain(readStructured([{
      type: "response.output_item.added",
      item: { type: "function_call", id: "a" },
    }], { integration: openAI })),
    (error) => {
      assertCompileBlocked(error);
      assert.equal(error.adapter, "openai");
      return true;
    },
  );
});

test("a blocked compile is not cached once the runtime allows Wasm", async () => {
  globalThis.WebAssembly = NativeWebAssembly;
  await prepareStreamfold();
  const scanner = createStructuredStream();
  scanner.push('{"a":');
  assert.deepEqual(scanner.push("[1]}").partialValue, { a: [1] });
  scanner.dispose();
});

test.after(() => {
  globalThis.WebAssembly = NativeWebAssembly;
});
