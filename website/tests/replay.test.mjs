import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const url = process.env.PREVIEW_URL ?? "http://127.0.0.1:4317";
const screenshots = new URL("../../artifacts/website/", import.meta.url);

async function assertIconSize(control) {
  const icon = await control.locator("svg").boundingBox();
  assert.deepEqual([icon.width, icon.height], [16, 16], await control.innerText());
}

for (const [mode, width, height] of [
  ["desktop", 1440, 900],
  ["phone", 390, 844],
  ["phone-320", 320, 640],
]) {
  test(mode + " production replay", async (t) => {
    const touch = mode !== "desktop";
    const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE });
    t.after(() => browser.close());
    const context = await browser.newContext({
      ...(touch ? devices["Pixel 7"] : {}),
      viewport: { width, height },
      reducedMotion: width === 320 ? "reduce" : "no-preference",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const activate = (name) => (touch ? button(name).tap() : button(name).press("Enter"));
    const response = await page.goto(url);
    assert.match(await response.text(), /Waiting for the first fragment/);
    assert.equal(new URL(page.url()).origin, new URL(url).origin);
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(
      await page.evaluate(() => [
        document.documentElement.clientWidth,
        document.documentElement.scrollWidth,
      ]),
      [width, width],
    );
    for (const name of ["npm", "pnpm", "Copy install command", "Play", "Step", "Reset"]) {
      const control = button(name);
      const bounds = await control.boundingBox();
      assert.ok(bounds.width >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width, name);
      assert.ok(
        touch ? bounds.height >= 44 : bounds.height >= 32 && bounds.height <= 36,
        name + " height: " + bounds.height,
      );
      const font = await control.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(font >= 12 && font <= 14, name + " label: " + font);
    }
    for (const name of ["Play", "Step", "Reset", "Copy install command"]) {
      await assertIconSize(button(name));
    }
    const installer = await page.locator(".install-wrap").boundingBox();
    const copy = await button("Copy install command").boundingBox();
    assert.ok(copy.x + copy.width <= installer.x + installer.width - 6);
    for (const link of await page.locator("nav a").all()) {
      const bounds = await link.boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44 && bounds.x + bounds.width <= width);
    }
    const play = await button("Play").boundingBox();
    assert.ok(play.y + play.height <= height);
    const [incoming, partial] = await Promise.all(
      (await page.locator(".pane").all()).map((pane) => pane.boundingBox()),
    );
    if (mode === "desktop") {
      assert.equal(incoming.y, partial.y);
      assert.ok(partial.x >= incoming.x + incoming.width - 1);
    } else {
      assert.ok(partial.y >= incoming.y + incoming.height - 1);
    }
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").textContent(), "Skip to content");
    assert.equal(await button("Reset").isDisabled(), true);
    await activate("Step");
    if (mode === "desktop") {
      assert.ok(
        await button("Step").evaluate(
          (el) => el.matches(":focus-visible") && getComputedStyle(el).outlineStyle !== "none",
        ),
      );
    }
    await activate("Step");
    assert.deepEqual(JSON.parse(await page.locator("pre").innerText()), { city: "San Fran" });
    await page.getByText("Paused · 2/5").waitFor();
    assert.equal((await button("Resume").boundingBox()).width, play.width);
    await assertIconSize(button("Resume"));
    await activate("Resume");
    assert.equal(await button("Step").isDisabled(), true);
    assert.equal((await button("Pause").boundingBox()).width, play.width);
    await assertIconSize(button("Pause"));
    await activate("Pause");
    assert.equal(await button("Step").isEnabled(), true);
    await activate("Resume");
    await page.getByText("Complete · 5/5").waitFor();
    assert.equal((await button("Replay").boundingBox()).width, play.width);
    await assertIconSize(button("Replay"));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.deepEqual(JSON.parse(await page.locator("pre").innerText()), {
      city: "San Francisco",
      units: "metric",
    });
    if (process.env.CAPTURE_PNG) {
      await mkdir(screenshots, { recursive: true });
      await page.getByRole("heading", { name: "Fragment replay" }).click();
      await page.screenshot({
        path: fileURLToPath(new URL(mode + "-console.png", screenshots)),
        fullPage: true,
      });
    }
    assert.equal(await button("Step").isDisabled(), true);
    await activate("Replay");
    await activate("Reset");
    await page.getByText("Ready · 0/5").waitFor();
    await activate("Play");
    await page.getByText("Complete · 5/5").waitFor();
    await button("Copy install command").scrollIntoViewIfNeeded();
    const beforeCopy = await button("Copy install command").boundingBox();
    await activate("Copy install command");
    await page.getByText("Copied", { exact: true }).waitFor();
    assert.equal(
      await page.locator(".install-wrap [role=status]").textContent(),
      "Copied to clipboard.",
    );
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "npm install streamfold",
    );
    assert.deepEqual(await button("Copy install command").boundingBox(), beforeCopy);
    await assertIconSize(button("Copy install command"));
    await button("Copy install command").getByText("Copy", { exact: true }).waitFor();
    await activate("pnpm");
    assert.equal(await button("pnpm").getAttribute("aria-pressed"), "true");
    assert.equal(await button("npm").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator(".install code").textContent(), "pnpm add streamfold");
    await activate("Copy install command");
    await page.getByText("Copied", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "pnpm add streamfold");
    await activate("npm");
    const protocol = await context.newCDPSession(page);
    await protocol.send("Browser.setPermission", {
      permission: { name: "clipboard-write", allowWithoutGesture: true },
      setting: "denied",
      origin: new URL(url).origin,
      browserContextId: (await protocol.send("Target.getTargetInfo")).targetInfo.browserContextId,
    });
    await activate("Copy install command");
    await page.getByRole("status").filter({ hasText: "Copy blocked" }).waitFor();
    assert.equal(await page.evaluate(() => getSelection()?.toString()), "npm install streamfold");
    assert.deepEqual(await button("Copy install command").boundingBox(), beforeCopy);
    await assertIconSize(button("Copy install command"));
    if (process.env.CAPTURE_PNG) {
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await button("Step").click();
      await button("Step").click();
      await page.getByText("Paused · 2/5").waitFor();
      await page.getByRole("heading", { name: "Fragment replay" }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.locator("button:focus, button:active, button:hover").count(), 0);
      await page.screenshot({ path: fileURLToPath(new URL(mode + ".png", screenshots)) });
    }
    assert.deepEqual(errors, []);
  });
}
