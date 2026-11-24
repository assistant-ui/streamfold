import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { get } from "node:http";
import test from "node:test";

async function startDashboard(t) {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  const port = await new Promise((resolve, reject) => {
    child.on("exit", (code) => reject(new Error(`dashboard exited with ${code} before listening:\n${stderr}`)));
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      if (match) resolve(Number(match[1]));
    });
  });
  return { child, port, stderr: () => stderr };
}

function request(port, path) {
  return new Promise((resolve, reject) => {
    get({ host: "127.0.0.1", port, path, agent: false }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
}

test("dashboard answers directory requests with 404 and keeps serving", async (t) => {
  const { child, port, stderr } = await startDashboard(t);

  for (const path of ["/dashboard/", "/dashboard", "/packages"]) {
    assert.equal(await request(port, path), 404, `${path}\n${stderr()}`);
  }
  assert.equal(await request(port, "/dashboard/missing.html"), 404);
  assert.equal(await request(port, "/../../../../etc/hosts"), 404);
  assert.equal(await request(port, "/"), 200);
  assert.equal(child.exitCode, null, stderr());
});
