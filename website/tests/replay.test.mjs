import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const url = process.env.PREVIEW_URL ?? "http://127.0.0.1:4317";
const screenshots = new URL("../../artifacts/website/", import.meta.url);

async function assertCompleteCaptionGap(page) {
  const gap = await page
    .locator("figcaption div")
    .last()
    .evaluate((row) => {
      const label = row.querySelector("span");
      const value = row.querySelector("code");
      const range = document.createRange();
      range.selectNodeContents(label);
      return value.getBoundingClientRect().left - range.getBoundingClientRect().right;
    });
  assert.ok(gap >= 12, `The complete label has ${gap}px of space before the value.`);
}

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
    assert.equal(new URL(page.url()).origin, new URL(url).origin);
    const fold = page.getByRole("img", { name: "JSON fragments folding into a paper plane" });
    await fold.waitFor({ timeout: 5000 });
    const figure = await fold.boundingBox();
    assert.ok(figure && figure.width >= 220 && figure.height >= 100);
    for (const name of ["Play", "Step", "Reset", "Copy install command"]) {
      const bounds = await button(name).boundingBox();
      assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44, name);
    }
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("body").evaluate((el) => getComputedStyle(el).margin), "0px");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
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
    await activate("Resume");
    assert.equal(await button("Step").isDisabled(), true);
    await activate("Pause");
    assert.equal(await button("Step").isEnabled(), true);
    await activate("Resume");
    await page.getByText("Complete · 5/5").waitFor();
    await assertCompleteCaptionGap(page);
    assert.deepEqual(JSON.parse(await page.locator("pre").innerText()), {
      city: "San Francisco",
      units: "metric",
    });
    assert.equal(
      await page.locator(".fold-scene figcaption code").last().textContent(),
      await page.locator("pre").textContent(),
    );
    await page
      .locator(".drawing")
      .evaluate((svg) => Promise.all(svg.getAnimations({ subtree: true }).map((a) => a.finished)));
    if (process.env.CAPTURE_PNG) {
      await mkdir(screenshots, { recursive: true });
      await page.screenshot({
        path: fileURLToPath(new URL(mode + "-motion.png", screenshots)),
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
    await button("Copy install command").getByText("Copy", { exact: true }).waitFor();
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
    assert.deepEqual(errors, []);
  });
}

test("Fold follows the parser, motion preferences and viewport", async (t) => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const response = await page.goto(url);
  const html = await response.text();
  assert.match(html, /aria-label="Play fold"/);
  assert.match(html, /<code>Waiting for input<\/code>/);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const docs = page.getByRole("navigation").getByRole("link", { name: "Docs" });
  await docs.hover();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("nav a"), "::after").transform ===
      "matrix(1, 0, 0, 1, 0, 0)",
  );
  await button("Play fold").hover();
  await page.mouse.down();
  assert.ok(
    await button("Play fold").evaluate(
      (el) => el.matches(":active") && getComputedStyle(el).boxShadow !== "none",
    ),
  );
  await page.mouse.up();
  await button("Pause fold").press("Enter");
  await button("Step").press("Enter");
  await page.waitForFunction(
    () => document.querySelector(".drawing").getAnimations({ subtree: true }).length === 1,
  );
  const motion = await page.locator(".drawing").evaluate((svg) => {
    const [flight] = svg.getAnimations({ subtree: true });
    flight.pause();
    const samples = [0, 320, 640].map((time) => {
      flight.currentTime = time;
      return getComputedStyle(flight.effect.target).transform;
    });
    flight.currentTime = 320;
    return { duration: flight.effect.getTiming().duration, samples };
  });
  assert.equal(motion.duration, 640);
  assert.equal(new Set(motion.samples).size, 3);
  assert.equal(await page.locator('.facets [data-pending="true"]').count(), 3);
  assert.deepEqual(JSON.parse(await page.locator("figcaption code").last().textContent()), {
    city: "San Fran",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () => !document.querySelector(".drawing").getAnimations({ subtree: true }).length,
  );
  await button("Step").press("Space");
  assert.equal(
    await page.locator(".drawing").evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    0,
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await button("Step").press("Enter");
  await page.waitForFunction(
    () => document.querySelector(".drawing").getAnimations({ subtree: true }).length === 1,
  );
  // Hold an actual flight so the observer, rather than the 640 ms finish, must stop it.
  await page.locator(".drawing").evaluate((svg) => svg.getAnimations({ subtree: true })[0].pause());
  await page.setViewportSize({ width: 320, height: 400 });
  await button("Step").scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelector(".drawing").getBoundingClientRect().bottom < 0 &&
      !document.querySelector(".drawing").getAnimations({ subtree: true }).length,
  );
  await button("Step").press("Enter");
  assert.equal(await page.locator('.facets [data-pending="true"]').count(), 0);
  assert.equal(
    await page.locator(".drawing").evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    0,
  );
});

test("320px touch layout starts still with reduced motion", async (t) => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE });
  t.after(() => browser.close());
  const page = await browser.newPage({
    ...devices["Pixel 7"],
    viewport: { width: 320, height: 640 },
    reducedMotion: "reduce",
  });
  await page.goto(url);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const link of await page.locator("nav a").all()) {
    const box = await link.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44 && box.x + box.width <= 320);
  }
  await page.getByRole("button", { name: "Play fold", exact: true }).tap();
  await page.getByRole("button", { name: "Pause fold", exact: true }).tap();
  assert.equal(
    await page.locator(".drawing").evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    0,
  );
  assert.equal(
    await page.locator("figcaption code").last().textContent(),
    await page.locator("pre").textContent(),
  );
  await page.getByRole("button", { name: "Resume fold", exact: true }).tap();
  await page.getByText("Complete · 5/5").waitFor();
  await assertCompleteCaptionGap(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});
