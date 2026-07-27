import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(
    new URL("../packages/core/package.json", import.meta.url),
    "utf8",
  ),
);
const version = packageJson.version;
const tag = `v${version}`;
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const findReleaseRun = () => {
  const output = execFileSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "Release",
      "--event",
      "push",
      "--branch",
      tag,
      "--limit",
      "20",
      "--json",
      "databaseId,headSha,status,conclusion,url",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output).find((run) => run.headSha === commit);
};

let releaseRun;
for (let attempt = 0; attempt < 30; attempt++) {
  releaseRun = findReleaseRun();
  if (releaseRun !== undefined) break;
  if (attempt === 0) {
    console.log(`Waiting for the ${tag} release workflow to start...`);
  }
  await wait(2_000);
}

if (releaseRun === undefined) {
  throw new Error(`No release workflow appeared for ${tag} at ${commit}`);
}

console.log(`Watching ${releaseRun.url}`);
const watched = spawnSync(
  "gh",
  ["run", "watch", String(releaseRun.databaseId), "--exit-status"],
  { stdio: "inherit" },
);
if (watched.status !== 0) process.exit(watched.status ?? 1);

let publishedVersion;
for (let attempt = 0; attempt < 15; attempt++) {
  try {
    publishedVersion = JSON.parse(
      execFileSync(
        "npm",
        ["view", `streamfold@${version}`, "version", "--json"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ),
    );
  } catch {
    if (attempt === 0) {
      console.log(`Waiting for streamfold@${version} to reach npm...`);
    }
  }
  if (publishedVersion === version) break;
  await wait(2_000);
}

if (publishedVersion !== version) {
  throw new Error(
    `Expected streamfold@${version}, received ${String(publishedVersion)}`,
  );
}

console.log(`Published streamfold@${version}`);
