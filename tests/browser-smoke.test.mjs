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
        response.end(
          "<!doctype html><title>Streamfold browser smoke test</title>",
        );
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
    browser = await browserType.launch({
      headless: true,
      ...(browserName === "chromium" && process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await page.evaluate(async () => {
      const {
        createStructuredStream,
        createStructuredStreamPool,
        prepareStreamfold,
        isStructuredStreamError,
        defineAdapter,
        readStructured,
        STREAMFOLD_ENGINE,
      } = await import("/src/index.js");
      await prepareStreamfold();
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
      let errorCode;
      try {
        createStructuredStream({ maxDepth: 1 }).push('{"nested":{');
      } catch (error) {
        limitError = error.message;
        if (isStructuredStreamError(error)) errorCode = error.code;
      }

      const adapter = defineAdapter((operations) => operations);
      const customStream = adapter();
      const customUpdates = customStream.pushAll([
        { type: "start", id: "browser" },
        { type: "delta", id: "browser", text: '{"ok":true}' },
        { type: "end", id: "browser" },
      ]);
      const remaining = customStream.finish().length;
      customStream.dispose();

      let managedValue;
      const eventSource = new ReadableStream({
        start(controller) {
          controller.enqueue([{ type: "start", id: "managed" }]);
          controller.enqueue([{ type: "delta", id: "managed", text: "42" }]);
          controller.close();
        },
      });
      for await (const update of readStructured(eventSource, { adapter })) {
        if ("value" in update) managedValue = update.value;
      }

      let readerOnlyValue;
      const readerOnlySource = new ReadableStream({
        start(controller) {
          controller.enqueue([
            { type: "start", id: "reader-only" },
            { type: "delta", id: "reader-only", text: "43" },
          ]);
          controller.close();
        },
      });
      Object.defineProperty(readerOnlySource, Symbol.asyncIterator, { value: undefined });
      for await (const update of readStructured(readerOnlySource, { adapter })) {
        if ("value" in update) readerOnlyValue = update.value;
      }

      const { langchain } = await import("/src/langchain.js");
      const calls = langchain(
        createStructuredStreamPool({ snapshots: "immutable" }),
      );
      const batch = calls.pushAll({
        tool_call_chunks: [
          { index: 0, id: "a", args: '{"items":[' },
          { index: 1, id: "b", args: "{}" },
          { index: 0, args: "1,2]}" },
        ],
      });
      const dx = {
        lifecycle: batch.map(({ type }) => type),
        earlier: batch[1].partialValue,
        frozen: Object.isFrozen(batch[4].partialValue.items),
        final: calls.finish().map(({ value }) => value),
      };
      const managedSdk = [];
      for await (const update of readStructured(
        [{ tool_call_chunks: [{ index: 0, id: "sdk", args: "42" }] }],
        { integration: langchain },
      )) {
        managedSdk.push(update.type);
      }

      const abortController = new AbortController();
      let cancelled = false;
      const stalled = new ReadableStream({
        start(controller) { controller.enqueue([{ type: "start", id: "cancel" }]); },
        cancel() { cancelled = true; },
      });
      const abortable = readStructured(stalled, { adapter, signal: abortController.signal });
      await abortable.next();
      const waiting = abortable.next();
      abortController.abort();
      let aborted = false;
      try { await waiting; }
      catch (error) { aborted = error === abortController.signal.reason; }

      return {
        cancellation: { aborted, cancelled, locked: stalled.locked },
        managedValue,
        readerOnly: { value: readerOnlyValue, locked: readerOnlySource.locked },
        managedSdk,
        custom: { value: customUpdates.at(-1).value, remaining },
        backend: STREAMFOLD_ENGINE,
        complete: final.complete,
        fieldState,
        limitError,
        errorCode,
        value,
        dx,
      };
    });

    assert.deepEqual(result, {
      cancellation: { aborted: true, cancelled: true, locked: false },
      managedSdk: ["start", "update", "complete"],
      managedValue: 42,
      readerOnly: { value: 43, locked: false },
      custom: { value: { ok: true }, remaining: 0 },
      backend: "rust-wasm",
      complete: true,
      fieldState: "complete",
      limitError: "Structured stream exceeds maxDepth (1) at 10",
      errorCode: "MAX_DEPTH_EXCEEDED",
      dx: {
        lifecycle: ["start", "update", "start", "update", "update"],
        earlier: { items: [] },
        frozen: true,
        final: [{ items: [1, 2] }, {}],
      },
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
