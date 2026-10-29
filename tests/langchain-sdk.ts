import { AIMessageChunk } from "@langchain/core/messages";
import { readStructured } from "streamfold";
import { langchain } from "streamfold/langchain";

const chunk = new AIMessageChunk({
  content: "",
  tool_call_chunks: [{ id: "paris", args: '{"city":"Paris"}' }],
});
langchain().pushAll(chunk);
readStructured([chunk], { integration: langchain });
