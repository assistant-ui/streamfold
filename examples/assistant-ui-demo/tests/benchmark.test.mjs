import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

test(
  "repeated browser benchmark reports real results and respects playback, reset, and cancellation",
  { timeout: 90_000 },
  async () => {
    const browser = await chromium.launch({
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        process.env.DEMO_URL ?? "http://127.0.0.1:4173/?view=compare",
      );
      const button = (name) => page.getByRole("button", { name, exact: true });
      const run = () => button("Run repeated benchmark");
      const results = page.getByTestId("benchmark-results");
      const readings = [];
      for (const scenario of ["weather", "trip"]) {
        await page
          .getByLabel("Scenario", { exact: true })
          .selectOption(scenario);
        await run().click();
        assert.ok(await button("Play both").isDisabled());
        await results.waitFor();
        assert.ok(await button("Play both").isEnabled());
        const text = await results.innerText();
        assert.match(text, /First replay/);
        assert.match(text, /Warm median/);
        for (const side of ["without", "with"]) {
          const median = Number.parseFloat(
            await page.getByTestId(`${side}-benchmark-median`).innerText(),
          );
          assert.ok(Number.isFinite(median) && median >= 0);
        }
        assert.match(
          await page
            .getByRole("status", { name: "Benchmark status" })
            .innerText(),
          /15 batches/,
        );
        readings.push({
          scenario,
          text,
          details: await page
            .getByRole("status", { name: "Benchmark status" })
            .innerText(),
        });
      }
      const output = resolve(
        process.env.DEMO_SCREENSHOTS ?? "../../artifacts/assistant-ui-demo",
      );
      await mkdir(output, { recursive: true });
      await writeFile(
        resolve(output, "repeated-browser-timings.json"),
        JSON.stringify({ browser: await browser.version(), readings }, null, 2),
      );
      console.log(JSON.stringify(readings));
      await page.screenshot({
        path: resolve(output, "benchmark-desktop.png"),
        fullPage: true,
      });
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `overflow at ${width}px`,
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: resolve(output, "benchmark-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await run().click();
      await button("Cancel benchmark").click();
      await page.waitForTimeout(300);
      assert.equal(await results.count(), 0);
      assert.ok(await button("Play both").isEnabled());

      await run().click();
      await button("Reset comparison").click();
      await page.waitForTimeout(300);
      assert.equal(await results.count(), 0);
      assert.ok(await button("Play both").isEnabled());

      await button("Play both").click();
      assert.ok(await run().isDisabled());
      await button("Stop").click();
      assert.ok(await run().isEnabled());
      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("malformed");
      assert.ok(await run().isDisabled());
      assert.match(
        await page
          .getByRole("status", { name: "Benchmark status" })
          .innerText(),
        /valid fixture/,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
