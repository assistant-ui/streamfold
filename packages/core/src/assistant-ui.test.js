import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantStream } from "assistant-stream";
import { readStructured } from "./index.js";
import { assistantUI } from "./assistant-ui.js";

const collect = async (source) => {
  const updates = [];
  for await (const update of readStructured(source, {
    integration: assistantUI,
    limits: { snapshots: "immutable" },
  })) updates.push(update);
  return updates;
};

test("SDK tool arguments stay separate after text and reasoning parts", async () => {
  const updates = await collect(createAssistantStream(async (controller) => {
    controller.appendText("Checking two cities.");
    controller.appendReasoning("Compare their forecasts.");
    const weather = controller.addToolCallPart({ toolName: "weather", toolCallId: "weather" });
    const forecast = controller.addToolCallPart({ toolName: "forecast", toolCallId: "forecast" });
    weather.argsText.append('{"city":"San');
    forecast.argsText.append('{"days":2}');
    await forecast.close();
    weather.argsText.append(' Francisco"}');
    await weather.close();
  }));

  assert.deepEqual(updates.filter(({ type }) => type === "start").map(({ id }) => id), ["weather", "forecast"]);
  assert.deepEqual(updates.filter(({ type, id }) => type === "update" && id === "weather").map(({ partialValue }) => partialValue), [
    { city: "San" }, { city: "San Francisco" },
  ]);
  const completed = updates.filter(({ type }) => type === "complete");
  assert.equal(completed.length, 2);
  assert.deepEqual(Object.fromEntries(completed.map(({ id, value }) => [id, value])), {
    weather: { city: "San Francisco" }, forecast: { days: 2 },
  });
});

test("merged SDK streams route remapped indexes and empty tool arguments", async () => {
  const updates = await collect(createAssistantStream((controller) => {
    controller.appendData({ type: "data", name: "context", data: { ready: true } });
    controller.merge(createAssistantStream(async (child) => {
      const tool = child.addToolCallPart({ toolName: "clock", toolCallId: "clock" });
      await tool.close();
    }));
    controller.merge(createAssistantStream(async (child) => {
      child.appendText("Checking Paris.");
      const tool = child.addToolCallPart({ toolName: "weather", toolCallId: "weather", args: { city: "Paris" } });
      await tool.close();
    }));
  }));

  const completed = updates.filter(({ type }) => type === "complete");
  assert.equal(completed.length, 2);
  assert.deepEqual(Object.fromEntries(completed.map(({ id, value }) => [id, value])), {
    clock: {}, weather: { city: "Paris" },
  });
});
