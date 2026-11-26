import { pathToFileURL } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createStructuredStreamPool } from "streamfold";
import { anthropic } from "streamfold/anthropic";

/**
 * Preview top-level tool inputs from one Agent SDK query.
 * @param {string} prompt
 * @param {import("@anthropic-ai/claude-agent-sdk").Options} options
 * @param {(update: import("streamfold").StructuredStreamLifecycleUpdate<string>) => void} onUpdate
 */
export async function previewToolInputs(prompt, options, onUpdate) {
  const pool = createStructuredStreamPool({ snapshots: "immutable" });
  const run = query({ prompt, options: { ...options, includePartialMessages: true } });
  /** @type {ReturnType<typeof anthropic> | undefined} */
  let stream;

  let receivedResult = false;

  function endMessage() {
    if (pool.size) {
      throw new Error(`Missing content_block_stop for tool call ${pool.activeIds.join(", ")}.`);
    }
    stream = undefined;
  }

  try {
    for await (const message of run) {
      options.abortController?.signal.throwIfAborted();
      if (message.type === "result") {
        if (message.subtype !== "success")
          throw new Error(message.errors.join("\n") || message.subtype);
        if (message.is_error) throw new Error(message.result);
        endMessage();
        receivedResult = true;
        continue;
      }
      if (message.type !== "stream_event" || message.parent_tool_use_id !== null) continue;
      const { event } = message;
      if (event.type === "message_start") {
        endMessage();
        stream = anthropic(pool);
      } else if (event.type === "message_stop") {
        endMessage();
      } else if (stream) {
        for (const update of stream.pushAll(event)) onUpdate(update);
      }
    }
    options.abortController?.signal.throwIfAborted();
    endMessage();
    if (!receivedResult) throw new Error("The query ended before its result message.");
  } finally {
    for (const id of pool.activeIds) pool.abort(id);
    run.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const abortController = new AbortController();
  const cancel = () => abortController.abort();
  process.once("SIGINT", cancel);
  try {
    await previewToolInputs(
      "Use Read to summarize README.md.",
      {
        abortController,
        tools: ["Read"],
        allowedTools: ["Read"],
        persistSession: false,
      },
      (update) => {
        console.log(
          update.type,
          update.id,
          update.type === "complete" ? update.value : update.partialValue,
        );
      },
    );
  } finally {
    process.off("SIGINT", cancel);
  }
}
