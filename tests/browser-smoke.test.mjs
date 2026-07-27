import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium, firefox, webkit } from "playwright";

const packageRoot = resolve(
  fileURLToPath(new URL("../packages/core/", import.meta.url)),
);
const browserName = process.env.STREAMFOLD_BROWSER ?? "chromium";
const browsers = { chromium, firefox, webkit };

const listen = (server) =>
  new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });

const close = (server) =>
  new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });

test(`runs the Rust/Wasm parser in ${browserName}`, async () => {
  const browserType = browsers[browserName];
  assert.ok(browserType, `Unsupported browser: ${browserName}`);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end("<!doctype html><title>Streamfold browser smoke test</title>");
        return;
      }

      const filePath = resolve(packageRoot, `.${url.pathname}`);
      if (
        !filePath.startsWith(`${packageRoot}${sep}`) ||
        extname(filePath) !== ".js"
      ) {
        response.statusCode = 404;
        response.end();
        return;
      }

      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.end(await readFile(filePath));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });

  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");

  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await page.evaluate(async () => {
      const { createStructuredStream, STREAMFOLD_ENGINE } = await import(
        "/src/index.js"
      );
      const stream = createStructuredStream();
      stream.push('{"city":"Addis ');
      stream.push("\ud83d");
      stream.push('\ude80 Ababa","items":[1,');
      const update = stream.push("2]}");
      const fieldState = stream.getFieldState(["city"]);
      const final = stream.finish();
      const value = JSON.parse(JSON.stringify(update.partialValue));
      stream.dispose();

      let limitError = "";
      try {
        createStructuredStream({ maxDepth: 1 }).push('{"nested":{');
      } catch (error) {
        limitError = error.message;
      }

      return {
        backend: STREAMFOLD_ENGINE,
        complete: final.complete,
        fieldState,
        limitError,
        value,
      };
    });

    assert.deepEqual(result, {
      backend: "rust-wasm",
      complete: true,
      fieldState: "complete",
      limitError: "Structured stream exceeds maxDepth (1) at 10",
      value: {
        city: "Addis 🚀 Ababa",
        items: [1, 2],
      },
    });
  } finally {
    await browser?.close();
    await close(server);
  }
});
