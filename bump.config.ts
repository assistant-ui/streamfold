import { defineConfig } from "bumpp";

export default defineConfig({
  commit: "chore: release v%s",
  // No tag: the Release workflow publishes from main, then tags.
  tag: false,
  push: true,
  files: ["package.json", "packages/core/package.json"],
  execute: "pnpm release:check",
});
