import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { fixtureEvents } from "../src/fixtures.ts";

// Observe the real UI at its normal pace. No extra parser warmups, profiler,
// hidden replays, or performance thresholds: a slower result is still a result.
const samples = Number(process.env.PLAYBACK_SAMPLES ?? 3);
assert.ok(
  Number.isInteger(samples) && samples > 0,
  "PLAYBACK_SAMPLES must be a positive integer",
);
const scenarios = (process.env.PLAYBACK_SCENARIOS ?? "weather,trip").split(",");
assert.ok(
  scenarios.every((value) => ["weather", "trip", "parallel"].includes(value)),
  "Choose valid weather, trip, or parallel scenarios",
);
const url = new URL(process.env.DEMO_URL ?? "http://127.0.0.1:4173");
url.searchParams.set("view", "compare");
const output = resolve(
  process.env.PLAYBACK_REPORT ??
    fileURLToPath(
      new URL(
        "../../../artifacts/assistant-ui-demo/paced-playback.json",
        import.meta.url,
      ),
    ),
);
const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
  headless: true,
});
const results = [];
try {
  for (const scenario of scenarios) {
    const expected = new Map();
    for (const event of fixtureEvents(scenario)) {
      const key = event.path.join("/");
      if (event.type === "part-start")
        expected.set(key, { id: event.part.toolCallId, text: "" });
      if (event.type === "text-delta")
        expected.get(key).text += event.textDelta;
    }
    const args = [...expected.values()].map(({ id, text }) => ({
      id,
      args: JSON.parse(text),
    }));
    for (let sample = 0; sample < samples; sample++) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        const session = await page.context().newCDPSession(page);
        await session.send("Performance.enable");
        const metrics = async () =>
          Object.fromEntries(
            (await session.send("Performance.getMetrics")).metrics.map(
              ({ name, value }) => [name, value],
            ),
          );
        await page.goto(url.href);
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="engine-warmup"]')?.dataset
              .state === "ready",
        );
        await page
          .getByLabel("Scenario", { exact: true })
          .selectOption(scenario);
        for (let replay = 0; replay < 2; replay++) {
          const before = await metrics();
          await page
            .getByRole("button", { name: "Play both", exact: true })
            .click();
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".comparison-state")].every(
              (element) => element.textContent === "complete",
            ),
          );
          await page.evaluate(
            () =>
              new Promise((resolvePaint) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(resolvePaint),
                ),
              ),
          );
          const after = await metrics();
          const pageWork = Object.fromEntries(
            [
              "ScriptDuration",
              "LayoutDuration",
              "RecalcStyleDuration",
              "TaskDuration",
            ].map((name) => [`${name}Ms`, (after[name] - before[name]) * 1000]),
          );
          for (const value of Object.values(pageWork)) {
            assert.ok(
              Number.isFinite(value) && value >= 0,
              "Chrome performance metric is unavailable",
            );
          }
          const observation = await page.evaluate(() => ({
            preparation: document.querySelector('[data-testid="engine-warmup"]')
              .textContent,
            delay: document.querySelector(
              '[aria-label="Event delay"], #compare-delay',
            ).value,
            sides: [...document.querySelectorAll(".comparison-pane")].map(
              (pane) => ({
                side: pane.classList.contains("without") ? "without" : "with",
                parserMs: Number(
                  pane.querySelector('[data-testid$="-parser-time"]').dataset
                    .ms,
                ),
                playbackMs: Number(
                  pane.querySelector('[data-testid$="-elapsed"]').dataset.ms,
                ),
                breakdown: pane.querySelector(".timing-breakdown").textContent,
                args: JSON.parse(
                  pane.querySelector('[data-testid$="-args"]').textContent,
                ),
              }),
            ),
          }));
          for (const side of observation.sides) {
            assert.deepEqual(
              side.args,
              args,
              `${scenario} ${side.side} output`,
            );
            delete side.args;
          }
          assert.deepEqual(errors, [], "browser errors");
          results.push({ scenario, sample, replay, pageWork, ...observation });
          console.log(JSON.stringify(results.at(-1)));
          await page
            .getByRole("button", { name: "Reset comparison", exact: true })
            .click();
        }
      } finally {
        await page.close();
      }
    }
  }
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        url: url.href,
        samples,
        methodology:
          "Whole-page Chrome metrics include both parser panes and React rendering, style, and layout through two animation frames after completion. They are not per-parser React timings. All samples are retained; no performance thresholds.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Saved ${output}`);
} finally {
  await browser.close();
}
