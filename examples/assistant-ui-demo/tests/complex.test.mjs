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
  "existing weather, chart, timeline, and table components render streamed nested data",
  { timeout: 90_000 },
  async () => {
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
    });
    try {
      await mkdir(screenshots, { recursive: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/?view=complex`);
      await page
        .getByRole("button", { name: "Run sample", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector(
            '[data-testid="forecast-tool"] [data-slot="chart"]',
          ) &&
          document.querySelector(
            '[data-testid="itinerary-tool"] [data-slot="timeline"]',
          ),
      );
      assert.equal(
        await page.getByTestId("itinerary-tool").getAttribute("data-complete"),
        "false",
      );
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".connection").textContent === "cancelled",
      );
      const inputCount = await page.getByTestId("input-count").innerText();
      const partial = await page.getByTestId("itinerary-tool").innerText();
      await page.waitForTimeout(400);
      assert.equal(
        await page.getByTestId("input-count").innerText(),
        inputCount,
      );
      assert.equal(
        await page.getByTestId("itinerary-tool").innerText(),
        partial,
      );
      assert.equal(
        await page.getByTestId("itinerary-tool").getAttribute("data-complete"),
        "false",
      );
      await page.screenshot({
        path: resolve(screenshots, "complex-partial.png"),
        fullPage: true,
      });

      await page.getByRole("button", { name: "Reset conversation" }).click();
      await page.getByLabel("Chunk delay").focus();
      await page.keyboard.press("Home");
      await page
        .getByRole("button", { name: "Run sample", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".connection").textContent === "complete",
      );
      for (const id of ["weather-tool", "forecast-tool", "itinerary-tool"])
        assert.equal(
          await page.getByTestId(id).getAttribute("data-complete"),
          "true",
        );
      assert.equal(
        await page.locator('[data-slot="weather-widget"]').count(),
        1,
      );
      assert.match(
        await page.getByTestId("weather-result").innerText(),
        /17 degrees Celsius/,
      );
      assert.equal(
        await page
          .getByRole("img", { name: "Hourly temperature: 15°C" })
          .count(),
        1,
      );
      await page
        .getByRole("button", { name: "Rain chance", exact: true })
        .click();
      assert.equal(
        await page.getByRole("img", { name: "Rain chance: 12%" }).count(),
        1,
      );
      await page
        .getByRole("button", { name: "Temperature", exact: true })
        .click();
      await page.getByRole("tab", { name: "Day 2", exact: true }).click();
      assert.match(
        await page.getByTestId("itinerary-tool").innerText(),
        /Golden Gate Park/,
      );
      await page.getByRole("tab", { name: "Day 2", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page
          .getByRole("tab", { name: "Day 3", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.match(
        await page.getByTestId("itinerary-tool").innerText(),
        /Mission District murals/,
      );
      assert.equal(await page.locator('[data-slot="data-table"]').count(), 1);
      assert.match(
        await page.getByTestId("itinerary-tool").innerText(),
        /Fictional stays and prices/,
      );
      await page
        .getByLabel("Tool call", { exact: true })
        .selectOption("trip-1");
      assert.equal(
        JSON.parse(await page.getByTestId("parsed-state").innerText()).days
          .length,
        3,
      );
      await page.getByRole("tab", { name: "Day 1", exact: true }).click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: resolve(screenshots, "complex-desktop.png"),
        fullPage: true,
        animations: "disabled",
      });
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `horizontal overflow at ${width}px`,
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: resolve(screenshots, "complex-mobile.png"),
        fullPage: true,
        animations: "disabled",
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
