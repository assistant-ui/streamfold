import { defineConfig } from "bumpp";

export default defineConfig({
  commit: "chore: release v%s",
  tag: "v%s",
  push: true,
  files: ["package.json", "packages/core/package.json"],
  execute: "pnpm release:check",
});
