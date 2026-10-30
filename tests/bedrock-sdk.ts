import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { readStructured } from "streamfold";
import { bedrock } from "streamfold/bedrock";

const client = new BedrockRuntimeClient({ region: "us-east-1" });
const response = await client.send(new ConverseStreamCommand({
  modelId: "fixture", messages: [{ role: "user", content: [{ text: "Weather in Paris?" }] }],
}));
if (response.stream) {
  readStructured(response.stream, { integration: bedrock });
  const stream = bedrock();
  for await (const event of response.stream) stream.pushAll(event);
}
