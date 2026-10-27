import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

const url = process.env.DEMO_URL ?? "http://127.0.0.1:4173";
const screenshots = resolve(
  process.env.DEMO_SCREENSHOTS ?? "../../artifacts/assistant-ui-demo",
);

test("official assistant-ui logo and / streamfold stay visible on every view", async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : {}),
    headless: true,
  });
  try {
    await mkdir(screenshots, { recursive: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const view of ["compare", "single", "complex"]) {
      await page.goto(`${url}/?view=${view}`);
      const header = page.locator(".app-header");
      const logo = header.getByRole("img", {
        name: "assistant-ui",
        exact: true,
      });
      await logo.waitFor();
      await logo.evaluate((image) => image.decode());
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await logo.evaluate((image) => image.naturalWidth), 150);
      for (const width of [320, 390, 480, 600, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await logo.isVisible());
        assert.ok(await header.getByText("/", { exact: true }).isVisible());
        assert.ok(
          await header.getByText("streamfold", { exact: true }).isVisible(),
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${view}: overflow at ${width}px`,
        );
        const brand = await header.locator(".brand").boundingBox();
        const nav = await header.getByRole("navigation").boundingBox();
        assert.ok(
          brand.x + brand.width <= nav.x || brand.y + brand.height <= nav.y,
          `${view}: header overlap at ${width}px`,
        );
        if (view === "compare" && (width === 390 || width === 1440))
          await header.screenshot({
            path: resolve(screenshots, `brand-${width}.png`),
          });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
