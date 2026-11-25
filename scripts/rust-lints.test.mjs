import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// `crates/streamfold-core/src/wasm.rs` only compiles for wasm32-unknown-unknown, so a
// host-only clippy run never sees its unsafe blocks. These checks keep the wasm-target
// lint in `pnpm check` and the unsafe-documentation lint in the workspace config.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const tomlSection = (source, header) => {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${header}]`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
};

test("pnpm check runs clippy for the wasm32 target with warnings denied", () => {
  const { scripts } = JSON.parse(read("package.json"));
  const commands = scripts.check.split("&&").map((command) => command.trim().split(/\s+/));
  const wasmClippy = commands.find(
    (args) =>
      args[0] === "cargo" &&
      args[1] === "clippy" &&
      args.includes("wasm32-unknown-unknown") &&
      args[args.indexOf("wasm32-unknown-unknown") - 1] === "--target",
  );
  assert.ok(wasmClippy, `no wasm32 clippy run in the check script: ${scripts.check}`);
  assert.deepEqual(wasmClippy.slice(wasmClippy.indexOf("--")), ["--", "-D", "warnings"]);
});

test("the workspace denies undocumented unsafe blocks and the core crate inherits it", () => {
  assert.ok(
    tomlSection(read("Cargo.toml"), "workspace.lints.clippy")?.includes(
      'undocumented_unsafe_blocks = "deny"',
    ),
    'Cargo.toml must set `undocumented_unsafe_blocks = "deny"` under [workspace.lints.clippy]',
  );
  assert.deepEqual(tomlSection(read("crates/streamfold-core/Cargo.toml"), "lints"), [
    "workspace = true",
  ]);
});
