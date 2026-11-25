import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const url = process.env.PREVIEW_URL ?? "http://127.0.0.1:4317";
const screenshots = new URL("../../artifacts/website/", import.meta.url);

for (const mode of ["desktop", "phone"]) {
  test(mode + " production replay", async (t) => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE });
    t.after(() => browser.close());
    const context = await browser.newContext({
      ...(mode === "phone" ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const activate = (name) =>
      mode === "phone" ? button(name).tap() : button(name).press("Enter");
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("body").evaluate((el) => getComputedStyle(el).margin), "0px");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").textContent(), "Skip to content");
    await activate("Step");
    await activate("Step");
    assert.deepEqual(JSON.parse(await page.locator("pre").innerText()), { city: "San Fran" });
    await page.getByText("Paused · 2/5").waitFor();
    if (process.env.CAPTURE_PNG) {
      await mkdir(screenshots, { recursive: true });
      await page.screenshot({
        path: fileURLToPath(new URL(mode + ".png", screenshots)),
        fullPage: true,
      });
    }
    await activate("Resume");
    await activate("Pause");
    assert.equal(await button("Step").isEnabled(), true);
    await activate("Resume");
    await page.getByText("Complete · 5/5").waitFor();
    assert.deepEqual(JSON.parse(await page.locator("pre").innerText()), {
      city: "San Francisco",
      units: "metric",
    });
    assert.equal(await button("Step").isDisabled(), true);
    await activate("Replay");
    await activate("Reset");
    await page.getByText("Ready · 0/5").waitFor();
    await activate("Play");
    await page.getByText("Complete · 5/5").waitFor();
    await activate("Copy install command");
    await page.getByText("Copied", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "npm install streamfold",
    );
    assert.deepEqual(errors, []);
  });
}
