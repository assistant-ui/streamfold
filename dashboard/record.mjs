import { spawn } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url);
const artifacts = new URL("../artifacts/", import.meta.url);
mkdirSync(artifacts, { recursive: true });

const server = spawn(process.execPath, ["dashboard/server.mjs"], {
  cwd: root,
  stdio: ["ignore", "pipe", "inherit"],
});

await new Promise((resolve, reject) => {
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("http://")) resolve();
  });
  server.on("error", reject);
});

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: artifacts.pathname,
    size: { width: 1440, height: 1000 },
  },
});
const page = await context.newPage();
await page.goto("http://127.0.0.1:4317/dashboard/product.html?autorun=1", {
  waitUntil: "networkidle",
});
await page.waitForSelector("#verdict.visible", { timeout: 30_000 });
await page.waitForTimeout(2_000);
await page.screenshot({
  path: fileURLToPath(new URL("streamfold-product-benchmark.png", artifacts)),
  fullPage: true,
});
const video = page.video();
await context.close();
const temporaryPath = await video.path();
await browser.close();
server.kill();
renameSync(temporaryPath, new URL("streamfold-benchmark.webm", artifacts));
console.log("Wrote artifacts/streamfold-benchmark.webm");
