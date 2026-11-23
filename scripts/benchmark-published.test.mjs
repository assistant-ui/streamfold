import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const integrity = "sha512-published==";
const metadata = (overrides = {}) => ({
  name: "streamfold",
  version: "0.1.20",
  "dist.integrity": integrity,
  "dist.tarball": "https://registry.example.test/streamfold/-/streamfold-0.1.20.tgz",
  "dist-tags": { latest: "0.1.20", beta: "0.1.21-beta.1" },
  ...overrides,
});
const previousResults = "{\"previous\":true}\n";

function runBenchmark(t, { requested, view = metadata(), installedVersion = "0.1.20", installedIntegrity = integrity }) {
  const root = mkdtempSync(join(tmpdir(), "streamfold-benchmark-published-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "benchmarks", "artifacts", "bin", "tmp", "node_modules/ai", "node_modules/assistant-stream"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "scripts/benchmark-published.mjs"), readFileSync(new URL("./benchmark-published.mjs", import.meta.url)));
  for (const name of ["published-benchmark-results.json", "published-sdk-adapter-results.json", "published-package.json"]) {
    writeFileSync(join(root, "artifacts", name), previousResults);
  }
  const fixture = join(root, "fixture.json");
  const commands = join(root, "commands.jsonl");
  writeFileSync(fixture, JSON.stringify({ view, installedVersion, installedIntegrity }));
  writeFileSync(commands, "");
  const benchmark = (file, result) => `
    import { appendFileSync, writeFileSync } from "node:fs";
    appendFileSync(process.env.BENCHMARK_TEST_COMMANDS, JSON.stringify({ name: "node", args: [${JSON.stringify(file)}] }) + "\\n");
    writeFileSync(${JSON.stringify(`artifacts/${result}`)}, JSON.stringify({ environment: { vercelAiSdk: "ai-test", assistantStream: "assistant-stream-test" } }));
  `;
  writeFileSync(join(root, "benchmarks/bench.mjs"), benchmark("bench.mjs", "benchmark-results.json"));
  writeFileSync(join(root, "benchmarks/sdk-adapters.mjs"), benchmark("sdk-adapters.mjs", "sdk-adapter-results.json"));
  writeFileSync(join(root, "bin/npm"), `#!${process.execPath}
    const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
    const args = process.argv.slice(2);
    const fixture = JSON.parse(readFileSync(process.env.BENCHMARK_TEST_FIXTURE, "utf8"));
    appendFileSync(process.env.BENCHMARK_TEST_COMMANDS, JSON.stringify({ name: "npm", args }) + "\\n");
    if (args[0] === "view") console.log(JSON.stringify(fixture.view));
    else if (args[0] === "install") {
      mkdirSync("node_modules/streamfold", { recursive: true });
      writeFileSync("node_modules/streamfold/package.json", JSON.stringify({ name: "streamfold", version: fixture.installedVersion }));
      writeFileSync("node_modules/.package-lock.json", JSON.stringify({ packages: {
        "node_modules/streamfold": { version: fixture.installedVersion, integrity: fixture.installedIntegrity },
      } }));
    } else throw new Error("Unexpected command: npm " + args.join(" "));
  `, { mode: 0o755 });
  const result = spawnSync(process.execPath, [join(root, "scripts/benchmark-published.mjs"), ...(requested === undefined ? [] : [requested])], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, TMPDIR: join(root, "tmp"),
      BENCHMARK_TEST_FIXTURE: fixture, BENCHMARK_TEST_COMMANDS: commands },
  });
  assert.equal(result.error, undefined);
  const calls = readFileSync(commands, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const artifact = name => readFileSync(join(root, "artifacts", name), "utf8");
  return { ...result, calls, artifact, artifactsUnchanged: () =>
    ["published-benchmark-results.json", "published-sdk-adapter-results.json", "published-package.json"]
      .every(name => artifact(name) === previousResults) && !existsSync(join(root, "artifacts/benchmark-results.json")) };
}

const installed = ({ calls }) => calls.find(({ name, args }) => name === "npm" && args[0] === "install");
const benchmarked = ({ calls }) => calls.some(({ name }) => name === "node");

for (const requested of [undefined, "0.1.20"]) {
  test(`benchmarks and records ${requested ?? "the latest"} published version`, (t) => {
    const result = runBenchmark(t, { requested });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(installed(result).args.at(-1), "streamfold@0.1.20");
    assert.match(result.stdout, /Benchmarked published streamfold@0\.1\.20/);
    const { "dist-tags": _distTags, ...recorded } = metadata();
    const published = JSON.parse(result.artifact("published-package.json"));
    assert.deepEqual(published, {
      benchmarkedAt: published.benchmarkedAt,
      ...recorded,
      dependencies: { ai: "ai-test", "assistant-stream": "assistant-stream-test" },
    });
    assert.notEqual(result.artifact("published-benchmark-results.json"), previousResults);
    assert.notEqual(result.artifact("published-sdk-adapter-results.json"), previousResults);
  });
}

test("accepts a dist-tag other than latest", (t) => {
  const result = runBenchmark(t, { requested: "beta", view: metadata({ version: "0.1.21-beta.1" }), installedVersion: "0.1.21-beta.1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(installed(result).args.at(-1), "streamfold@0.1.21-beta.1");
});

test("keeps previous results when the installed version differs", (t) => {
  const result = runBenchmark(t, { requested: "0.1.20", installedVersion: "0.1.19" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Installed streamfold@0\.1\.19, expected 0\.1\.20/);
  assert.equal(benchmarked(result), false);
  assert.ok(result.artifactsUnchanged());
});

test("keeps previous results when the installed integrity differs from the registry", (t) => {
  const result = runBenchmark(t, { requested: "0.1.20", installedIntegrity: "sha512-other==" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Installed streamfold@0\.1\.20 has integrity sha512-other==, but npm lists sha512-published==/);
  assert.equal(benchmarked(result), false);
  assert.ok(result.artifactsUnchanged());
});

test("rejects a range that matches several versions", (t) => {
  const result = runBenchmark(t, { requested: ">=0.1.19", view: [metadata({ version: "0.1.19" }), metadata()] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /streamfold@>=0\.1\.19 matches 2 versions \(0\.1\.19, 0\.1\.20\)\. Pass an exact version or a dist-tag/);
  assert.equal(installed(result), undefined);
  assert.ok(result.artifactsUnchanged());
});

test("rejects a range that matches one version", (t) => {
  const result = runBenchmark(t, { requested: "^0.1.20" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /streamfold@\^0\.1\.20 is a range or an alias for 0\.1\.20\. Pass an exact version or a dist-tag/);
  assert.equal(installed(result), undefined);
  assert.ok(result.artifactsUnchanged());
});
