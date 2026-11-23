import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const requestedVersion = process.argv[2] ?? "latest";
const resolved = JSON.parse(
  execFileSync(
    "npm",
    [
      "view",
      `streamfold@${requestedVersion}`,
      "name",
      "version",
      "dist.integrity",
      "dist.tarball",
      "dist-tags",
      "--json",
    ],
    { encoding: "utf8" },
  ),
);
// npm view returns one entry per matching version, so a range can resolve to
// several packages. Benchmark exactly one, named by version or dist-tag.
if (Array.isArray(resolved)) {
  throw new Error(
    `streamfold@${requestedVersion} matches ${resolved.length} versions ` +
    `(${resolved.map((entry) => entry.version).join(", ")}). ` +
    "Pass an exact version or a dist-tag, for example `pnpm bench:published 0.1.20` or `pnpm bench:published latest`.",
  );
}
const {
  "dist-tags": distTags = {},
  ...packageMetadata
} = resolved;
const version = packageMetadata.version;
if (requestedVersion !== version && distTags[requestedVersion] !== version) {
  throw new Error(
    `streamfold@${requestedVersion} is a range or an alias for ${version}. ` +
    `Pass an exact version or a dist-tag, for example \`pnpm bench:published ${version}\`.`,
  );
}
const expectedIntegrity = packageMetadata["dist.integrity"];
if (typeof expectedIntegrity !== "string" || expectedIntegrity === "") {
  throw new Error(`npm did not report dist.integrity for streamfold@${version}.`);
}
const temporaryRoot = mkdtempSync(join(tmpdir(), "streamfold-benchmark-"));

try {
  writeFileSync(
    join(temporaryRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "streamfold-published-benchmark",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      `streamfold@${version}`,
    ],
    { cwd: temporaryRoot, stdio: "inherit" },
  );

  const installedPackage = JSON.parse(
    readFileSync(
      join(temporaryRoot, "node_modules", "streamfold", "package.json"),
      "utf8",
    ),
  );
  if (installedPackage.version !== version) {
    throw new Error(
      `Installed streamfold@${installedPackage.version}, expected ${version}`,
    );
  }
  // npm records the integrity it verified for each installed tarball in the
  // hidden lockfile that describes node_modules.
  const installedIntegrity = JSON.parse(
    readFileSync(join(temporaryRoot, "node_modules", ".package-lock.json"), "utf8"),
  ).packages?.["node_modules/streamfold"]?.integrity;
  if (installedIntegrity !== expectedIntegrity) {
    throw new Error(
      `Installed streamfold@${version} has integrity ${installedIntegrity}, ` +
      `but npm lists ${expectedIntegrity}. No results were written.`,
    );
  }

  symlinkSync(
    realpathSync(join(root, "node_modules", "ai")),
    join(temporaryRoot, "node_modules", "ai"),
    "dir",
  );
  symlinkSync(
    realpathSync(join(root, "node_modules", "assistant-stream")),
    join(temporaryRoot, "node_modules", "assistant-stream"),
    "dir",
  );
  cpSync(join(root, "benchmarks"), join(temporaryRoot, "benchmarks"), {
    recursive: true,
  });
  mkdirSync(join(temporaryRoot, "artifacts"));

  const environment = {
    ...process.env,
    STREAMFOLD_SKIP_NATIVE: "1",
    STREAMFOLD_BENCHMARK_SOURCE: packageMetadata["dist.tarball"],
  };
  execFileSync(process.execPath, ["benchmarks/bench.mjs"], {
    cwd: temporaryRoot,
    env: environment,
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    [
      "--expose-gc",
      "--max-old-space-size=384",
      "benchmarks/sdk-adapters.mjs",
    ],
    {
      cwd: temporaryRoot,
      env: environment,
      stdio: "inherit",
    },
  );
  const sdkReport = JSON.parse(
    readFileSync(join(temporaryRoot, "artifacts", "sdk-adapter-results.json"), "utf8"),
  );

  mkdirSync(join(root, "artifacts"), { recursive: true });
  copyFileSync(
    join(temporaryRoot, "artifacts", "benchmark-results.json"),
    join(root, "artifacts", "published-benchmark-results.json"),
  );
  copyFileSync(
    join(temporaryRoot, "artifacts", "sdk-adapter-results.json"),
    join(root, "artifacts", "published-sdk-adapter-results.json"),
  );
  writeFileSync(
    join(root, "artifacts", "published-package.json"),
    `${JSON.stringify(
      {
        benchmarkedAt: new Date().toISOString(),
        ...packageMetadata,
        dependencies: {
          ai: sdkReport.environment.vercelAiSdk,
          "assistant-stream": sdkReport.environment.assistantStream,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Benchmarked published streamfold@${version}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
