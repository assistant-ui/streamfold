import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { registerJsonParserBackend } from "assistant-stream";
import { IncrementalJsonObjectParser } from "assistant-stream/utils";
import { IncrementalJsonScanner } from "./index.js";

const registry = () => globalThis[Symbol.for("assistant-stream.json-parser-backends.v1")] ?? [];
let imports = 0;
const fresh = () => import(`./assistant-ui.js?teardown=${++imports}`);

test("disable removes the owned registration, is idempotent, and permits re-enable", async (t) => {
  const backend = await fresh();
  t.after(() => backend.disableAssistantStream?.());
  const before = registry().length;
  assert.equal(await backend.initializeAssistantStream(), true);
  assert.equal(registry().length, before + 1);
  backend.disableAssistantStream?.();
  assert.equal(registry().length, before);
  backend.disableAssistantStream();
  assert.equal(registry().length, before);
  assert.deepEqual(
    await Promise.all([backend.initializeAssistantStream(), backend.initializeAssistantStream()]),
    [true, true],
  );
  assert.equal(registry().length, before + 1);
});

test("disable preserves existing native and Wasm parsers and affects only future parsers", async (t) => {
  const backend = await fresh();
  t.after(() => backend.disableAssistantStream?.());
  const native = IncrementalJsonObjectParser.from('{"value":"');
  assert.equal(await backend.initializeAssistantStream(), true);
  const active = IncrementalJsonObjectParser.from('{"value":"');
  backend.disableAssistantStream();
  const push = t.mock.method(IncrementalJsonScanner.prototype, "push");
  assert.equal(native.append('native"}').currentArgs.value, "native");
  assert.equal(push.mock.callCount(), 0);
  assert.equal(active.append('active"}').currentArgs.value, "active");
  assert.equal(push.mock.callCount(), 1);
  const later = IncrementalJsonObjectParser.from('{"value":"');
  assert.equal(later.append('later"}').currentArgs.value, "later");
  assert.equal(push.mock.callCount(), 1);
});

test("disable removes only its registration and preserves other backend precedence", async (t) => {
  const backend = await fresh();
  t.after(() => backend.disableAssistantStream?.());
  const older = registerJsonParserBackend(() => undefined);
  t.after(older);
  const before = [...registry()];
  assert.equal(await backend.initializeAssistantStream(), true);
  let visits = 0;
  const newer = registerJsonParserBackend(() => {
    visits++;
    return undefined;
  });
  t.after(newer);
  const last = registry().at(-1);
  backend.disableAssistantStream();
  assert.deepEqual(registry(), [...before, last]);
  IncrementalJsonObjectParser.from('{"value":"');
  assert.equal(visits, 1);
});

test("module reload owners can unregister independently without accumulating entries", async (t) => {
  const first = await fresh();
  const second = await fresh();
  t.after(() => first.disableAssistantStream?.());
  t.after(() => second.disableAssistantStream?.());
  const before = [...registry()];
  assert.equal(await first.initializeAssistantStream(), true);
  assert.equal(await second.initializeAssistantStream(), true);
  const secondRegistration = registry().at(-1);
  first.disableAssistantStream();
  assert.deepEqual(registry(), [...before, secondRegistration]);
  second.disableAssistantStream();
  assert.deepEqual(registry(), before);
  for (let reload = 0; reload < 3; reload++) {
    const next = await fresh();
    assert.equal(await next.initializeAssistantStream(), true);
    next.disableAssistantStream();
    assert.deepEqual(registry(), before);
  }
});

test("disable cancels pending initialization without cancelling a later enable", async (t) => {
  const backend = await fresh();
  t.after(() => backend.disableAssistantStream?.());
  const before = registry().length;
  const cancelled = backend.initializeAssistantStream();
  const shared = backend.initializeAssistantStream();
  backend.disableAssistantStream();
  const enabled = backend.initializeAssistantStream();
  assert.deepEqual(await Promise.all([cancelled, shared, enabled]), [false, false, true]);
  assert.equal(registry().length, before + 1);
  backend.disableAssistantStream();
  assert.equal(registry().length, before);
});

test("disable during Wasm compilation prevents late registration and allows retry", () => {
  execFileSync(
    process.execPath,
    [
      ...process.execArgv,
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    const backend = await import(${JSON.stringify(new URL("./assistant-ui.js", import.meta.url).href)});
    const deferred = () => {
      let resolve;
      const promise = new Promise((fulfill) => {
        resolve = fulfill;
      });
      return { promise, resolve };
    };
    const entered = deferred();
    const released = deferred();
    const compile = WebAssembly.compile;
    WebAssembly.compile = async (...args) => {
      entered.resolve();
      await released.promise;
      return Reflect.apply(compile, WebAssembly, args);
    };
    const registry = () => globalThis[Symbol.for('assistant-stream.json-parser-backends.v1')] ?? [];
    const before = registry().length;
    const pending = backend.initializeAssistantStream();
    await entered.promise;
    backend.disableAssistantStream();
    released.resolve();
    assert.equal(await pending, false);
    assert.equal(registry().length, before);
    WebAssembly.compile = compile;
    assert.equal(await backend.initializeAssistantStream(), true);
    assert.equal(registry().length, before + 1);
    backend.disableAssistantStream();
    assert.equal(registry().length, before);
  `,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
});
