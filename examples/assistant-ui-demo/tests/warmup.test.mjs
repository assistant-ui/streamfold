import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

test(
  "background warm-up caches the page engine, preserves cold worker benchmarks, and handles early playback",
  { timeout: 90_000 },
  async () => {
    const browser = await chromium.launch({
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
      headless: true,
    });
    try {
      const origin =
        process.env.DEMO_URL ?? "http://127.0.0.1:4173/?view=compare";
      const url = new URL(origin);
      url.searchParams.set("view", "compare");
      const instrument = async (page) =>
        page.addInitScript(() => {
          window.__wasmInstances = 0;
          WebAssembly.Instance = new Proxy(WebAssembly.Instance, {
            construct(target, args, newTarget) {
              window.__wasmInstances++;
              return Reflect.construct(target, args, newTarget);
            },
          });
        });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await instrument(page);
      await page.goto(url.href);
      const status = page.getByTestId("engine-warmup");
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="engine-warmup"]')?.dataset
            .state === "ready",
      );
      assert.equal(await status.getAttribute("data-source"), "background");
      assert.equal(await status.getAttribute("data-attempts"), "1");
      assert.equal(await page.evaluate(() => window.__wasmInstances), 1);
      assert.match(
        await page.getByTestId("event-progress").innerText(),
        /Event 0/,
      );
      assert.equal(
        await page.getByTestId("with-parser-time").getAttribute("data-ms"),
        "0",
      );
      const setupMs = await status.getAttribute("data-ms");
      const button = (name) => page.getByRole("button", { name, exact: true });
      for (let replay = 0; replay < 2; replay++) {
        await page.getByLabel("Event delay").focus();
        await page.keyboard.press("Home");
        await button("Play both").click();
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".comparison-state")].every(
            (element) => element.textContent === "complete",
          ),
        );
        assert.equal(await page.evaluate(() => window.__wasmInstances), 1);
        assert.equal(await status.getAttribute("data-ms"), setupMs);
        await button("Reset comparison").click();
      }
      await button("Run repeated benchmark").click();
      await page.getByTestId("benchmark-results").waitFor();
      assert.match(
        await page.getByTestId("benchmark-results").innerText(),
        /not shared with that worker/,
      );
      assert.equal(await page.evaluate(() => window.__wasmInstances), 1);
      const output = resolve(
        process.env.DEMO_SCREENSHOTS ?? "../../artifacts/assistant-ui-demo",
      );
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: resolve(output, "warmup-desktop.png"),
        fullPage: true,
      });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      assert.deepEqual(errors, []);

      const early = await browser.newPage();
      await instrument(early);
      // Hold idle work until after playback has initialized the engine itself.
      await early.addInitScript(() => {
        window.requestIdleCallback = (callback) =>
          window.setTimeout(callback, 30_000);
        window.cancelIdleCallback = (id) => window.clearTimeout(id);
      });
      await early.goto(url.href);
      await early.getByRole("button", { name: "Step", exact: true }).click();
      assert.equal(
        await early.getByTestId("engine-warmup").getAttribute("data-source"),
        "first-use",
      );
      assert.equal(await early.evaluate(() => window.__wasmInstances), 1);
      await early
        .getByRole("button", { name: "Reset comparison", exact: true })
        .click();
      await early.getByRole("button", { name: "Step", exact: true }).click();
      assert.equal(await early.evaluate(() => window.__wasmInstances), 1);

      const fallback = await browser.newPage();
      await fallback.addInitScript(() => {
        window.requestIdleCallback = undefined;
      });
      await instrument(fallback);
      url.searchParams.set("view", "single");
      await fallback.goto(url.href);
      await fallback.waitForFunction(
        () =>
          document.querySelector('[data-testid="engine-warmup"]')?.dataset
            .state === "ready",
      );
      assert.equal(
        await fallback.getByTestId("engine-warmup").getAttribute("data-source"),
        "background",
      );
      assert.equal(await fallback.evaluate(() => window.__wasmInstances), 1);
      await fallback
        .getByRole("button", { name: "Run sample", exact: true })
        .click();
      await fallback.getByTestId("weather-result").waitFor();
      assert.equal(await fallback.evaluate(() => window.__wasmInstances), 1);
    } finally {
      await browser.close();
    }
  },
);
