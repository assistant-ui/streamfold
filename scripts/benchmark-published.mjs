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
const packageMetadata = JSON.parse(
  execFileSync(
    "npm",
    [
      "view",
      `streamfold@${requestedVersion}`,
      "name",
      "version",
      "dist.integrity",
      "dist.tarball",
      "--json",
    ],
    { encoding: "utf8" },
  ),
);
const version = packageMetadata.version;
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

  mkdirSync(join(root, "artifacts"), { recursive: true });
  copyFileSync(
    join(temporaryRoot, "artifacts", "benchmark-results.json"),
    join(root, "artifacts", "published-benchmark-results.json"),
  );
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
          ai: "7.0.22",
          "assistant-stream": "0.3.25",
        },
      },
      null,
      2,
    )}\n`,
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
  console.log(`Benchmarked published streamfold@${version}`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
