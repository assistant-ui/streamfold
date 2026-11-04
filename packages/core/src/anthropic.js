import { createStructuredStreamPool } from "./index.js";
import { createIntegration } from "./internal/integration.js";

export const anthropic = (pool = createStructuredStreamPool(), options) => {
  const callsByIndex = new Map();
  const completeCall = (complete, { id, emptyArguments }) =>
    complete(id, emptyArguments ? () => "{}" : undefined);

  return createIntegration(
    pool,
    (event, calls) => {
      if (event.type === "error") {
        throw new Error(event.error?.message ?? "Anthropic stream failed", { cause: event.error });
      }
      if (
        event.type === "content_block_start" &&
        (event.content_block.type === "tool_use" ||
          event.content_block.type === "server_tool_use")
      ) {
        callsByIndex.set(event.index, {
          id: event.content_block.id,
          emptyArguments: JSON.stringify(event.content_block.input) === "{}",
        });
        return calls.start(event.content_block.id);
      }

      const call = callsByIndex.get(event.index);
      if (call === undefined) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "input_json_delta"
        ) {
          calls.unmatched("Arguments delta has no matching tool block index");
        }
        return undefined;
      }

      if (
        event.type === "content_block_delta" &&
        event.delta.type === "input_json_delta"
      ) {
        if (event.delta.partial_json !== "") call.emptyArguments = false;
        return calls.push(call.id, event.delta.partial_json);
      }
      if (event.type === "content_block_stop") {
        callsByIndex.delete(event.index);
        return completeCall(calls.complete, call);
      }
      return undefined;
    },
    (complete) => {
      for (const call of callsByIndex.values()) completeCall(complete, call);
      callsByIndex.clear();
    },
    "anthropic",
    options,
  );
};

export { anthropic as createStructuredStream };
