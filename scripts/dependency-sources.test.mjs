import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Preview and tarball URLs (pkg.pr.new, GitHub archives, git refs) can disappear or change
// after the fact, which breaks fresh installs. Workspace dependencies must resolve from the
// npm registry or from the workspace itself.
const unstable = /^(?:https?:|git(?:\+[a-z]+)?:|github:|[\w.-]+\/[\w.-]+#)/;
const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const manifests = ["package.json", "packages/core/package.json"];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("workspace manifests do not depend on preview or tarball URLs", () => {
  const offenders = manifests.flatMap((path) => {
    const manifest = JSON.parse(read(path));
    return fields.flatMap((field) =>
      Object.entries(manifest[field] ?? {})
        .filter(([, specifier]) => unstable.test(specifier))
        .map(([name, specifier]) => `${path} ${field}.${name}: ${specifier}`),
    );
  });
  assert.deepEqual(offenders, []);
});

test("the lockfile resolves every package from the registry or the workspace", () => {
  const offenders = read("pnpm-lock.yaml")
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(
      ({ line }) =>
        (/^(?:specifier|version): /.test(line) && unstable.test(line.replace(/^\w+: /, ""))) ||
        /\btarball: /.test(line),
    )
    .map(({ line, number }) => `pnpm-lock.yaml:${number} ${line}`);
  assert.deepEqual(offenders, []);
});
