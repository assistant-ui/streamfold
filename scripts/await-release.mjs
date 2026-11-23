import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(
    new URL("../packages/core/package.json", import.meta.url),
    "utf8",
  ),
);
const version = packageJson.version;
// The commit that set the current package version, found the same way the
// Release workflow finds it. Later pushes that keep this version also start a
// Release run, but only the push of this commit is the release.
const releaseCommit = execFileSync("git", [
  "log", "-1", "--format=%H", "-G^[[:space:]]*\"version\":", "--",
  "packages/core/package.json",
], { encoding: "utf8" }).trim();
if (releaseCommit === "") {
  throw new Error(
    `Could not find the commit that set streamfold@${version} in packages/core/package.json. ` +
    "Run pnpm release:await from a checkout of main that includes the release commit.",
  );
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const versionsByCommit = new Map();
const releaseVersion = (sha) => {
  if (!versionsByCommit.has(sha)) {
    const content = execFileSync("gh", [
      "api", `repos/{owner}/{repo}/contents/packages/core/package.json?ref=${sha}`,
      "--jq", ".content",
    ], { encoding: "utf8" });
    versionsByCommit.set(sha, JSON.parse(Buffer.from(content.trim(), "base64").toString("utf8")).version);
  }
  return versionsByCommit.get(sha);
};

const findReleaseRun = () => {
  const output = execFileSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "Release",
      "--limit",
      "20",
      "--json",
      "databaseId,event,headBranch,headSha,status,conclusion,url",
    ],
    { encoding: "utf8" },
  );
  // Releases run only on main: the push of the version bump, or a manual
  // retry of the current main version.
  return JSON.parse(output).find((run) =>
    run.headBranch === "main" &&
    ((run.event === "push" && run.headSha === releaseCommit) ||
      (run.event === "workflow_dispatch" && releaseVersion(run.headSha) === version)));
};

let releaseRun;
for (let attempt = 0; attempt < 30; attempt++) {
  releaseRun = findReleaseRun();
  if (releaseRun !== undefined) break;
  if (attempt === 0) {
    console.log(`Waiting for the streamfold@${version} release workflow to start...`);
  }
  await wait(2_000);
}

if (releaseRun === undefined) {
  throw new Error(`No release workflow on main appeared for streamfold@${version}`);
}

console.log(`Watching ${releaseRun.url}`);
const watched = spawnSync(
  "gh",
  ["run", "watch", String(releaseRun.databaseId), "--exit-status"],
  { stdio: "inherit" },
);
if (watched.status !== 0) process.exit(watched.status ?? 1);

let publishedVersion;
let verificationError;
let retryDelay = 2_000;
const publicationDeadline = Date.now() + 5 * 60_000;
console.log(`Release workflow succeeded. Waiting up to five minutes to verify streamfold@${version} on npm...`);
while (true) {
  const remaining = publicationDeadline - Date.now();
  if (remaining <= 0) break;
  try {
    publishedVersion = JSON.parse(
      execFileSync(
        "npm",
        ["view", `streamfold@${version}`, "version", "--json"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: Math.min(30_000, remaining),
          killSignal: "SIGKILL",
        },
      ),
    );
    verificationError = `Expected streamfold@${version}, received ${JSON.stringify(publishedVersion)}`;
  } catch (error) {
    verificationError = error.stderr?.toString().trim() || error.message;
  }
  if (publishedVersion === version) break;
  const delay = Math.min(retryDelay, publicationDeadline - Date.now());
  if (delay <= 0) break;
  await wait(delay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

if (publishedVersion !== version) {
  throw new Error(
    `Release workflow succeeded, but npm publication of streamfold@${version} was not verified within five minutes.\n` +
    `Last npm verification error: ${verificationError}\n` +
    "Run pnpm release:await to check again without publishing another version.",
  );
}

console.log(`Published streamfold@${version}`);
