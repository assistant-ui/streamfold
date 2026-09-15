import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

const url = process.env.DEMO_URL ?? "http://127.0.0.1:4173";
const screenshots = resolve(
  process.env.DEMO_SCREENSHOTS ?? "../../artifacts/assistant-ui-demo",
);

test(
  "assistant-ui renders real streamed tool parts on desktop and mobile",
  { timeout: 90_000 },
  async () => {
    const browser = await chromium.launch({
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
      headless: true,
    });
    await mkdir(screenshots, { recursive: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/?view=single`);
      await page
        .getByRole("button", { name: "Run sample", exact: true })
        .waitFor();
      await page.getByLabel("Chunk delay").focus();
      await page.keyboard.press("End");
      await page
        .getByRole("button", { name: "Run sample", exact: true })
        .click();
      await page.waitForFunction(() => {
        const state = document.querySelector(
          '[data-testid="parsed-state"]',
        )?.textContent;
        return (
          state &&
          JSON.parse(state).city === "San Francisco" &&
          !JSON.parse(state).notes
        );
      });
      assert.equal(
        await page.locator(".weather-waiting strong").innerText(),
        "--°",
      );
      await page.screenshot({
        path: resolve(screenshots, "desktop-streaming.png"),
      });
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector(".connection")?.textContent === "cancelled",
      );
      const stoppedCount = await page.getByTestId("input-count").innerText();
      await page.waitForTimeout(500);
      assert.equal(
        await page.getByTestId("input-count").innerText(),
        stoppedCount,
      );
      assert.equal(
        await page.locator(".weather-waiting strong").innerText(),
        "--°",
      );
      assert.match(
        await page.locator(".session-details").innerText(),
        /Closed/,
      );

      await page.getByRole("button", { name: "Reset conversation" }).click();
      await page
        .getByRole("button", { name: "Run sample", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".connection")?.textContent === "complete",
      );
      assert.match(
        await page.getByTestId("weather-result").innerText(),
        /17 degrees Celsius/,
      );
      assert.match(
        await page.getByTestId("parsed-state").innerText(),
        /San Francisco/,
      );
      await page.getByRole("button", { name: "Copy parsed JSON" }).click();
      assert.equal(
        JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
          .city,
        "San Francisco",
      );
      await page.getByRole("tab", { name: "Parsed state" }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page
          .getByRole("tab", { name: /Event log/ })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.ok((await page.locator(".event-row").count()) > 20);
      await page.getByRole("tab", { name: "Integration", exact: true }).click();
      assert.match(
        await page.locator(".integration-code").innerText(),
        /readStructured\(source\(\)/,
      );
      await page.getByRole("tab", { name: "Parsed state" }).click();
      await page.waitForFunction(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      await page.screenshot({
        path: resolve(screenshots, "desktop-complete.png"),
      });

      await page.getByRole("button", { name: "Reset conversation" }).click();
      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("parallel");
      await page
        .getByRole("button", { name: "Run sample", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".connection")?.textContent === "complete",
      );
      assert.equal(await page.getByTestId("weather-tool").count(), 2);
      await page
        .getByLabel("Tool call", { exact: true })
        .selectOption("weather-2");
      assert.equal(
        JSON.parse(await page.getByTestId("parsed-state").innerText()).city,
        "Oakland",
      );

      await page.getByRole("button", { name: "Reset conversation" }).click();
      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("malformed");
      await page
        .getByRole("button", { name: "Run sample", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".connection")?.textContent === "error",
      );
      assert.match(
        await page.getByRole("alert").innerText(),
        /Argument parsing failed/,
      );
      assert.equal(
        await page.locator(".weather-waiting strong").innerText(),
        "--°",
      );
      await page.screenshot({
        path: resolve(screenshots, "desktop-error.png"),
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Reset conversation" }).click();
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Replay the forecast fixture");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".connection")?.textContent === "complete",
      );
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `horizontal overflow at ${width}px`,
        );
        assert.ok(await page.getByTestId("weather-tool").isVisible());
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: resolve(screenshots, "mobile-complete.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
