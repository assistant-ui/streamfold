import assert from "node:assert/strict";
import test from "node:test";
import {
  createStructuredStream,
  readStructured,
  StructuredStreamPool,
} from "streamfold";
import { assistantUI } from "streamfold/assistant-ui";
import { createSdkCases, createToolInputs } from "./sdk-cases.mjs";

test("all SDK envelopes produce identical concurrent tool inputs", () => {
  const inputs = createToolInputs({
    calls: 4,
    targetBytes: 20_000,
    chunkSize: 7,
  });

  for (const sdkCase of createSdkCases(inputs)) {
    const adapter = sdkCase.createAdapter();
    let partialUpdates = 0;
    for (const event of sdkCase.events) {
      const update = adapter.push(event);
      if (update?.partialValue !== undefined) {
        partialUpdates++;
        assert.equal(
          inputs.some((input) => input.id === update.id),
          true,
          sdkCase.name,
        );
      }
    }
    const results = adapter.finish();
    const byId = new Map(results.map((result) => [result.id, result]));

    assert.equal(results.length, inputs.length, sdkCase.name);
    assert.equal(partialUpdates > 0, true, sdkCase.name);
    for (const input of inputs) {
      const result = byId.get(input.id);
      assert.deepEqual(result?.value, input.value, sdkCase.name);
      assert.equal(result?.text, input.text, sdkCase.name);
      assert.equal(result?.complete, true, sdkCase.name);
    }
  }
});

test("root factory composes with an integration export", () => {
  const inputs = createToolInputs({
    calls: 1,
    targetBytes: 1_000,
    chunkSize: 11,
  });
  const assistantUiCase = createSdkCases(inputs)[0];
  const stream = createStructuredStream(assistantUI);

  for (const event of assistantUiCase.events) stream.push(event);

  assert.deepEqual(stream.finish()[0].value, inputs[0].value);
});

test("every SDK adapter supports batch lifecycle updates with either snapshot mode", () => {
  const inputs = createToolInputs({
    calls: 3,
    targetBytes: 3_000,
    chunkSize: 11,
  });
  for (const snapshots of ["live", "immutable"]) {
    for (const sdkCase of createSdkCases(inputs)) {
      const diagnostics = [];
      const adapter = sdkCase.createAdapter(
        new StructuredStreamPool({ snapshots }),
        {
          onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        },
      );
      const updates = sdkCase.events.flatMap((event) => adapter.pushAll(event));
      assert.equal(
        updates.filter(({ type }) => type === "start").length,
        inputs.length,
        sdkCase.name,
      );
      for (const input of inputs) {
        const callUpdates = updates.filter(({ id }) => id === input.id);
        assert.equal(callUpdates[0].type, "start", sdkCase.name);
        assert.equal(
          callUpdates.some(({ type }) => type === "update"),
          true,
          sdkCase.name,
        );
        const expectedEnd = sdkCase.name.includes("LangChain")
          ? "update"
          : "complete";
        assert.equal(callUpdates.at(-1).type, expectedEnd, sdkCase.name);
        if (snapshots === "immutable") {
          assert.equal(callUpdates[0].partialValue, undefined, sdkCase.name);
          assert.equal(
            Object.isFrozen(callUpdates.at(-1).partialValue),
            true,
            sdkCase.name,
          );
        }
      }
      const results = adapter.finish();
      assert.deepEqual(
        results.map(({ value }) => value),
        inputs.map(({ value }) => value),
        sdkCase.name,
      );
      assert.deepEqual(diagnostics, [], sdkCase.name);
    }
  }
});

test("integration failures are terminal and release every active stream", () => {
  const pool = new StructuredStreamPool();
  const stream = assistantUI(pool);

  for (const [path, id] of [
    [[0], "first"],
    [[1], "second"],
  ]) {
    stream.push({
      type: "part-start",
      path,
      part: { type: "tool-call", toolCallId: id, toolName: "test" },
    });
    stream.push({ type: "text-delta", path, textDelta: '{"value":' });
  }

  assert.throws(() => stream.finish(), SyntaxError);
  assert.equal(pool.size, 0);
  assert.throws(
    () =>
      stream.push({
        type: "text-delta",
        path: [0],
        textDelta: "1}",
      }),
    SyntaxError,
  );
});

test("managed consumption supports every SDK integration without replaying completions", async () => {
  const inputs = createToolInputs({
    calls: 3,
    targetBytes: 3_000,
    chunkSize: 11,
  });
  for (const sdkCase of createSdkCases(inputs)) {
    const updates = [];
    for await (const update of readStructured(sdkCase.events, {
      integration: sdkCase.createAdapter,
    })) {
      updates.push(structuredClone(update));
    }
    const completed = updates.filter(({ type }) => type === "complete");
    assert.deepEqual(
      completed.map(({ value }) => value),
      inputs.map(({ value }) => value),
      sdkCase.name,
    );
    assert.equal(
      updates.filter(({ type }) => type === "start").length,
      inputs.length,
      sdkCase.name,
    );
  }
});
