import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const tagRun = (overrides = {}) => ({
  databaseId: 1, event: "push", headBranch: "v0.1.14", headSha: "tag-commit",
  status: "completed", conclusion: "success", url: "https://example.test/runs/1",
  ...overrides,
});
const retryRun = (overrides = {}) => ({
  databaseId: 2, event: "workflow_dispatch", headBranch: "main", headSha: "retry-commit",
  status: "completed", conclusion: "success", url: "https://example.test/runs/2",
  ...overrides,
});

function runWaiter(t, { runs, versions = {}, head = "tag-commit" }) {
  const root = mkdtempSync(join(tmpdir(), "streamfold-await-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "packages/core", "bin"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "scripts/await-release.mjs"), readFileSync(new URL("./await-release.mjs", import.meta.url)));
  writeFileSync(join(root, "packages/core/package.json"), JSON.stringify({ version: "0.1.14" }));
  const fixture = join(root, "fixture.json");
  const commands = join(root, "commands.jsonl");
  writeFileSync(fixture, JSON.stringify({ runs, versions: { "retry-commit": "0.1.14", ...versions }, head }));
  const shim = `#!${process.execPath}
    const { appendFileSync, readFileSync } = require("node:fs");
    const name = require("node:path").basename(process.argv[1]);
    const args = process.argv.slice(2);
    const fixture = JSON.parse(readFileSync(process.env.RELEASE_TEST_FIXTURE, "utf8"));
    appendFileSync(process.env.RELEASE_TEST_COMMANDS, JSON.stringify({ name, args }) + "\\n");
    if (name === "git" && args[0] === "rev-parse") console.log(fixture.head);
    else if (name === "npm" && args[0] === "view") console.log(JSON.stringify("0.1.14"));
    else if (name === "gh" && args[0] === "run" && args[1] === "list") {
      const flag = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
      console.log(JSON.stringify(fixture.runs.filter(run =>
        (!flag("--event") || run.event === flag("--event")) &&
        (!flag("--branch") || run.headBranch === flag("--branch")))));
    } else if (name === "gh" && args[0] === "run" && args[1] === "watch") {
      const run = fixture.runs.find(run => String(run.databaseId) === args[2]);
      process.exit(run.watchExit ?? (run.conclusion === "success" ? 0 : 1));
    } else if (name === "gh" && args[0] === "api" && args[1].endsWith("/commits/v0.1.14")) {
      console.log("tag-commit");
    } else if (name === "gh" && args[0] === "api" && args[1].includes("/contents/packages/core/package.json?ref=")) {
      const sha = args[1].split("?ref=")[1];
      if (!(sha in fixture.versions)) throw new Error("Unexpected commit: " + sha);
      console.log(Buffer.from(JSON.stringify({ version: fixture.versions[sha] })).toString("base64"));
    } else throw new Error("Unexpected command: " + name + " " + args.join(" "));
  `;
  for (const name of ["git", "gh", "npm"]) writeFileSync(join(root, "bin", name), shim, { mode: 0o755 });
  const result = spawnSync(process.execPath, [join(root, "scripts/await-release.mjs")], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`,
      RELEASE_TEST_FIXTURE: fixture, RELEASE_TEST_COMMANDS: commands },
  });
  assert.equal(result.error, undefined);
  const calls = readFileSync(commands, "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { ...result, calls, watched: calls.find(({ name, args }) => name === "gh" && args[1] === "watch")?.args[2] };
}

test("recognizes a successful manual retry after a failed tag release", (t) => {
  const result = runWaiter(t, { runs: [retryRun(), tagRun({ conclusion: "failure" })] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.watched, "2");
  assert.match(result.stdout, /Published streamfold@0\.1\.14/);
});

test("finds the tagged release from a newer checkout without a local tag", (t) => {
  const result = runWaiter(t, { head: "workflow-fix", runs: [tagRun()] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.watched, "1");
});

test("ignores manual releases for other versions or branches and stale tag commits", (t) => {
  const result = runWaiter(t, { runs: [
    retryRun({ databaseId: 5, headSha: "next-version" }),
    retryRun({ databaseId: 4, headBranch: "feature" }),
    tagRun({ databaseId: 3, headSha: "old-tag-commit" }),
    tagRun(),
  ], versions: { "next-version": "0.1.15" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.watched, "1");
});

test("a failing matching retry is not hidden by an older successful release", (t) => {
  const result = runWaiter(t, { runs: [retryRun({ conclusion: "failure" }), tagRun()] });
  assert.equal(result.status, 1);
  assert.equal(result.watched, "2");
  assert.equal(result.calls.some(({ name }) => name === "npm"), false);
});

test("waits for an in-progress retry before verifying npm publication", (t) => {
  const result = runWaiter(t, { runs: [retryRun({ status: "in_progress", conclusion: "", watchExit: 0 }), tagRun()] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.watched, "2");
  assert.deepEqual(result.calls.at(-1), { name: "npm", args: ["view", "streamfold@0.1.14", "version", "--json"] });
});
