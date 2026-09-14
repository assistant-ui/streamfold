import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const anthropic = (pool = createStructuredStreamPool()) => {
  const idsByIndex = new Map();

  return createIntegration(pool, (event, calls) => {
    if (
      event.type === "content_block_start" &&
      (event.content_block.type === "tool_use" ||
        event.content_block.type === "server_tool_use")
    ) {
      idsByIndex.set(event.index, event.content_block.id);
      return calls.start(event.content_block.id);
    }

    const id = idsByIndex.get(event.index);
    if (id === undefined) return undefined;

    if (
      event.type === "content_block_delta" &&
      event.delta.type === "input_json_delta"
    ) {
      return calls.push(id, event.delta.partial_json);
    }
    if (event.type === "content_block_stop") {
      idsByIndex.delete(event.index);
      return calls.complete(id);
    }
    return undefined;
  });
};

export { anthropic as createStructuredStream };
