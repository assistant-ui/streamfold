import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const wasm = new URL(
  "../target/wasm32-unknown-unknown/release/streamfold_core.wasm",
  import.meta.url,
);
const output = new URL(
  "../packages/core/src/internal/wasm-binary.js",
  import.meta.url,
);

execFileSync(
  "cargo",
  [
    "build",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "-p",
    "streamfold-core",
    "--lib",
  ],
  { cwd: root, stdio: "inherit" },
);

const bytes = readFileSync(wasm);
mkdirSync(new URL("../packages/core/src/internal", import.meta.url), {
  recursive: true,
});
writeFileSync(
  output,
  `export const wasmBinaryBase64 = "${bytes.toString("base64")}";\n`,
);
console.log(`Generated ${output.pathname} (${bytes.length} Wasm bytes)`);
