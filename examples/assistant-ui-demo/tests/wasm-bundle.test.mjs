import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";
import { wasmBinaryBase64 } from "../../../packages/core/src/internal/wasm-binary.js";

test("bundles sync and async preparation with one WASM payload", async () => {
  const bundles = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      lib: {
        entry: fileURLToPath(
          new URL("../../../packages/core/src/index.js", import.meta.url),
        ),
        formats: ["es"],
        fileName: "streamfold",
      },
    },
  });
  const chunks = [bundles]
    .flat()
    .flatMap((bundle) => bundle.output)
    .filter((item) => item.type === "chunk");
  assert.equal(chunks.length, 1);
  const code = chunks[0].code;
  assert.equal(
    code.split(wasmBinaryBase64).length - 1,
    1,
    "the minifier must not duplicate the embedded WASM binary",
  );

  for (const mode of ["sync", "async"]) {
    const api = await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${mode}`
    );
    if (mode === "async") await api.prepareStreamfold();
    const stream = api.createStructuredStream();
    try {
      stream.push('{"value":"hello');
      assert.deepEqual(stream.push(' world"}').partialValue, {
        value: "hello world",
      });
      await api.prepareStreamfold();
    } finally {
      stream.dispose();
    }
  }
});
