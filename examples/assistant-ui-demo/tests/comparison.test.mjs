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
  "with/without comparison shares playback and renders both real parser outputs",
  { timeout: 90_000 },
  async () => {
    const browser = await chromium.launch({
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
      headless: true,
    });
    try {
      await mkdir(screenshots, { recursive: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page
        .getByRole("button", { name: "Play both", exact: true })
        .waitFor();
      const button = (name) => page.getByRole("button", { name, exact: true });
      const timings = () =>
        page.locator(".parser-timing").evaluateAll((panels) =>
          panels.map((panel) => ({
            elapsed: Number(
              panel.querySelector('[data-testid$="-elapsed"]').dataset.ms,
            ),
            parser: Number(
              panel.querySelector('[data-testid$="-parser-time"]').dataset.ms,
            ),
          })),
        );
      assert.deepEqual(await timings(), [
        { elapsed: 0, parser: 0 },
        { elapsed: 0, parser: 0 },
      ]);
      const panes = [
        page.getByTestId("without-pane"),
        page.getByTestId("with-pane"),
      ];
      for (let i = 0; i < 8; i++) await button("Step").click();
      assert.match(
        await page.getByTestId("event-progress").innerText(),
        /^Event 8 \/ /,
      );
      for (const pane of panes) {
        assert.equal(
          await pane.getByTestId("city").innerText(),
          "San Francisco",
        );
        assert.equal(
          await pane.locator(".weather-waiting strong").innerText(),
          "--°",
        );
      }
      const leftInput = await page.getByTestId("without-input").innerText();
      const rightInput = await page.getByTestId("with-input").innerText();
      assert.ok(leftInput.length > rightInput.length);
      assert.ok(leftInput.endsWith(rightInput));
      const progress = await page.getByTestId("event-progress").innerText();
      const steppedTimings = await timings();
      await page.waitForTimeout(400);
      assert.deepEqual(await timings(), steppedTimings);
      assert.equal(
        await page.getByTestId("event-progress").innerText(),
        progress,
      );
      await page.screenshot({
        path: resolve(screenshots, "compare-partial.png"),
        fullPage: true,
      });

      await button("Resume").click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-testid="event-progress"]')
            .textContent.startsWith("Event 8 /"),
      );
      const counting = await timings();
      await page.waitForFunction(
        (previous) =>
          [...document.querySelectorAll('[data-testid$="-elapsed"]')].every(
            (element, index) =>
              Number(element.dataset.ms) > previous[index].elapsed,
          ),
        counting,
      );
      await button("Pause").click();
      const paused = await page.getByTestId("event-progress").innerText();
      const pausedTimings = await timings();
      await page.waitForTimeout(400);
      assert.deepEqual(await timings(), pausedTimings);
      assert.equal(
        await page.getByTestId("event-progress").innerText(),
        paused,
      );
      await button("Stop").click();
      for (const side of ["without", "with"])
        assert.equal(
          await page.getByTestId(`${side}-state`).textContent(),
          "cancelled",
        );
      for (const pane of panes)
        assert.equal(
          await pane.locator(".weather-waiting strong").innerText(),
          "--°",
        );
      assert.ok(await button("Step").isDisabled());
      const stoppedTimings = await timings();
      await page.waitForTimeout(200);
      assert.deepEqual(await timings(), stoppedTimings);

      await button("Reset comparison").click();
      assert.deepEqual(await timings(), [
        { elapsed: 0, parser: 0 },
        { elapsed: 0, parser: 0 },
      ]);
      await page.getByLabel("Event delay").focus();
      await page.keyboard.press("Home");
      await button("Play both").click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".comparison-state")].every(
          (el) => el.textContent === "complete",
        ),
      );
      for (const pane of panes)
        assert.match(
          await pane.getByTestId("weather-result").innerText(),
          /17 degrees Celsius/,
        );
      assert.equal(
        await page.getByTestId("without-bytes").innerText(),
        "950 B",
      );
      assert.equal(await page.getByTestId("with-bytes").innerText(), "95 B");
      const completedTimings = await timings();
      for (const timing of completedTimings) {
        assert.ok(timing.elapsed > 0);
        assert.ok(timing.parser >= 0 && timing.parser < timing.elapsed);
      }
      for (const side of ["without", "with"])
        assert.match(
          await page.getByTestId(`${side}-timing-status`).innerText(),
          /Finished in/,
        );
      await page.waitForTimeout(200);
      assert.deepEqual(await timings(), completedTimings);
      await page.screenshot({
        path: resolve(screenshots, "compare-complete.png"),
        fullPage: true,
      });

      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("parallel");
      assert.deepEqual(await timings(), [
        { elapsed: 0, parser: 0 },
        { elapsed: 0, parser: 0 },
      ]);
      assert.match(
        await page.getByTestId("event-progress").innerText(),
        /^Event 0 /,
      );
      await page.getByLabel("Event delay").focus();
      await page.keyboard.press("Home");
      await button("Play both").click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".comparison-state")].every(
          (el) => el.textContent === "complete",
        ),
      );
      for (const pane of panes) {
        assert.equal(await pane.getByTestId("weather-tool").count(), 2);
        assert.deepEqual(await pane.getByTestId("city").allInnerTexts(), [
          "San Francisco",
          "Oakland",
        ]);
        assert.match(
          await pane.getByTestId("weather-result").nth(0).innerText(),
          /17 degrees Celsius/,
        );
        assert.match(
          await pane.getByTestId("weather-result").nth(1).innerText(),
          /20 degrees Celsius/,
        );
      }

      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("malformed");
      await page.getByLabel("Event delay").focus();
      await page.keyboard.press("Home");
      await button("Play both").click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".comparison-state")].every(
          (el) => el.textContent === "error",
        ),
      );
      for (const pane of panes) {
        assert.equal(await pane.getByRole("alert").count(), 1);
        assert.equal(
          await pane.locator(".weather-waiting strong").innerText(),
          "--°",
        );
      }
      const failedTimings = await timings();
      assert.ok(failedTimings[1].elapsed < failedTimings[0].elapsed);
      await page.waitForTimeout(200);
      assert.deepEqual(await timings(), failedTimings);
      assert.match(
        await page.locator(".comparison-takeaway").innerText(),
        /different events/,
      );
      await page.screenshot({
        path: resolve(screenshots, "compare-error.png"),
        fullPage: true,
      });

      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption("weather");
      for (let i = 0; i < 8; i++) await button("Step").click();
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `horizontal overflow at ${width}px`,
        );
        for (const pane of panes)
          assert.ok(await pane.getByTestId("weather-tool").isVisible());
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: resolve(screenshots, "compare-mobile.png"),
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "Single stream", exact: true })
        .click();
      await button("Run sample").waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
