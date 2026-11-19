import test from "node:test";
import { execFileSync } from "node:child_process";

for (const decoder of ["typed-array", "buffer", "atob"]) {
  for (const prepared of [false, true]) {
    test(`initializes Wasm with ${decoder} decoding (${prepared ? "prepared" : "synchronous"})`, () => {
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import assert from "node:assert/strict";
        const Buffer = globalThis.Buffer;
        const atob = globalThis.atob;
        let decodes = 0;
        Uint8Array.fromBase64 = undefined;
        globalThis.Buffer = undefined;
        globalThis.atob = () => { throw new Error("Unexpected fallback"); };
        if (${JSON.stringify(decoder)} === "typed-array") {
          Uint8Array.fromBase64 = (text) => {
            decodes++;
            return new Uint8Array(Buffer.from(text, "base64"));
          };
        } else if (${JSON.stringify(decoder)} === "buffer") {
          globalThis.Buffer = { from(text, encoding) {
            decodes++;
            return Buffer.from(text, encoding);
          } };
        } else {
          globalThis.atob = (text) => { decodes++; return atob(text); };
        }
        const { createStructuredStream, prepareStreamfold } = await import(${JSON.stringify(new URL("./index.js", import.meta.url).href)});
        if (${prepared}) await prepareStreamfold();
        for (let i = 0; i < 2; i++) {
          const stream = createStructuredStream();
          const expected = { city: "東京", emoji: "🌾", number: 1.25 };
          const json = JSON.stringify(expected);
          for (const chunk of json) stream.push(chunk);
          assert.deepEqual(stream.finish().partialValue, expected);
          stream.dispose();
        }
        assert.equal(decodes, 1);
      `,
        ],
        { stdio: "pipe" },
      );
    });
  }
}
