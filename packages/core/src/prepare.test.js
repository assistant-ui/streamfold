import assert from "node:assert/strict";
import test from "node:test";
import { IncrementalJsonScanner, prepareStreamfold } from "./index.js";

test("prepares WebAssembly once, retries failures, and shares the compiled module", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(WebAssembly, "compile");
  const moduleDescriptor = Object.getOwnPropertyDescriptor(
    WebAssembly,
    "Module",
  );
  const compile = WebAssembly.compile.bind(WebAssembly);
  const NativeModule = WebAssembly.Module;
  let rejectFirst;
  let attempts = 0;
  let synchronousCompiles = 0;

  Object.defineProperty(WebAssembly, "compile", {
    ...descriptor,
    value: (bytes) => {
      attempts++;
      if (attempts === 1) {
        return new Promise((_, reject) => {
          rejectFirst = reject;
        });
      }
      return compile(bytes);
    },
  });

  try {
    const first = prepareStreamfold();
    assert.equal(prepareStreamfold(), first);
    assert.equal(attempts, 1);
    rejectFirst(new Error("temporary compile failure"));
    await assert.rejects(first, /temporary compile failure/);

    await prepareStreamfold();
    assert.equal(attempts, 2);

    Object.defineProperty(WebAssembly, "Module", {
      ...moduleDescriptor,
      value: class extends NativeModule {
        constructor(...args) {
          synchronousCompiles++;
          super(...args);
        }
      },
    });
    const scanner = new IncrementalJsonScanner();
    try {
      scanner.push('{"ok":');
      assert.equal(scanner.push("true}").complete, true);
      assert.deepEqual(scanner.finish().partialValue, { ok: true });
    } finally {
      scanner.dispose();
    }
    assert.equal(synchronousCompiles, 0);

    await prepareStreamfold();
    assert.equal(attempts, 2);
  } finally {
    Object.defineProperty(WebAssembly, "compile", descriptor);
    Object.defineProperty(WebAssembly, "Module", moduleDescriptor);
  }
});
