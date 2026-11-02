import assert from "node:assert/strict";
import test from "node:test";
import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { readStructured } from "../packages/core/src/index.js";
import { bedrock } from "../packages/core/src/bedrock.js";

for (const stopReason of ["malformed_model_output", "malformed_tool_use", "end_turn", "tool_use"]) {
  test(`AWS SDK message stop preserves the ${stopReason} outcome`, async () => {
    const events = [
      { messageStart: { role: "assistant" } },
      ...(stopReason === "tool_use" ? [
        { contentBlockStart: { contentBlockIndex: 0, start: { toolUse: { toolUseId: "weather", name: "weather" } } } },
        { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{"city":"Paris"}' } } } },
        { contentBlockStop: { contentBlockIndex: 0 } },
      ] : []),
      { messageStop: { stopReason } },
    ];
    const client = new BedrockRuntimeClient({
      region: "us-east-1",
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
      requestHandler: {
        async handle() {
          const source = (async function* () { yield* events; })();
          const body = client.config.eventStreamMarshaller.serialize(source, (event) => {
            const [type, payload] = Object.entries(event)[0];
            return {
              headers: {
                ":message-type": { type: "string", value: "event" },
                ":event-type": { type: "string", value: type },
                ":content-type": { type: "string", value: "application/json" },
              },
              body: new TextEncoder().encode(JSON.stringify(payload)),
            };
          });
          return { response: { statusCode: 200, headers: { "content-type": "application/vnd.amazon.eventstream" }, body } };
        },
      },
    });
    try {
      const response = await client.send(new ConverseStreamCommand({
        modelId: "test-model", messages: [{ role: "user", content: [{ text: "Weather?" }] }],
      }));
      let decodedStop;
      let closed = false;
      const source = (async function* () {
        try {
          for await (const event of response.stream) {
            if (event.messageStop) decodedStop = event.messageStop;
            yield event;
          }
        } finally { closed = true; }
      })();
      const completed = [];
      const consume = async () => {
        for await (const update of readStructured(source, { integration: bedrock })) {
          if (update.type === "complete") completed.push(update.value);
        }
      };
      if (stopReason.startsWith("malformed_")) {
        await assert.rejects(consume, (error) => {
          assert.equal(error.message, `Bedrock generation failed: ${stopReason}`);
          assert.equal(error.code, "INTEGRATION_ERROR");
          assert.equal(error.cause, decodedStop);
          return true;
        });
      } else {
        await consume();
      }
      assert.equal(decodedStop.stopReason, stopReason);
      assert.deepEqual(completed, stopReason === "tool_use" ? [{ city: "Paris" }] : []);
      assert.equal(closed, true);
    } finally {
      client.destroy();
    }
  });
}
