import { createStructuredStreamPool } from "../index.js";
import { createIntegration } from "./integration.js";

/** Parse function tool arguments from one Chat Completions request. */
export const createChatCompletions = (pool, options, adapter, normalize, getFinalText) => {
  let finalTexts;
  const choices = new Map();
  const seenIds = new Set();
  const finishedChoices = new Set();
  const clear = () => {
    finalTexts?.clear();
    choices.clear();
    seenIds.clear();
    finishedChoices.clear();
  };
  const requireIndex = (value, name) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Chat Completions ${name} must be a nonnegative integer; pass decoded SDK chunks.`,
      );
    }
  };

  return createIntegration(
    pool,
    (frame, calls) => {
      const event = normalize ? normalize(frame) : frame;
      if (event.error != null) {
        throw event.error instanceof Error
          ? event.error
          : new Error(
              event.error.message ?? "Chat Completions request failed.",
              { cause: event.error },
            );
      }
      let update;
      for (const choice of event.choices ?? []) {
        const reason = choice.finish_reason;
        if (choice.delta?.function_call != null || reason === "function_call") {
          throw new Error(
            "Chat Completions function_call is unsupported; request function tools with `tools` instead.",
          );
        }
        if (reason != null && reason !== "stop" && reason !== "tool_calls") {
          throw new Error(
            `Chat Completions ended with finish_reason ${reason}; retry a complete response.`,
            { cause: choice },
          );
        }
        const tools = choice.delta?.tool_calls ?? [];
        if (tools.length === 0 && reason == null) continue;
        requireIndex(choice.index, "choice.index");
        if (finishedChoices.has(choice.index)) {
          if (tools.length !== 0)
            throw new Error(
              "Chat Completions choice already finished; use a new integration for each request.",
            );
          continue;
        }
        let ids = choices.get(choice.index);
        for (const tool of tools) {
          requireIndex(tool.index, "tool.index");
          if (
            (tool.type !== undefined && tool.type !== "function") ||
            tool.custom !== undefined
          ) {
            if (ids?.has(tool.index))
              throw new Error(
                "Chat Completions tool type changed; preserve each tool's type and index.",
              );
            continue;
          }
          if (
            tool.function === undefined &&
            !ids?.has(tool.index) &&
            tool.type !== "function"
          )
            continue;
          let id = ids?.get(tool.index);
          if (id === undefined) {
            if (typeof tool.id !== "string" || tool.id.length === 0) {
              throw new Error(
                "Chat Completions tool is missing its id; include the first chunk for every tool.",
              );
            }
            if (seenIds.has(tool.id))
              throw new Error(
                "Chat Completions tool id is reused; use unique IDs within a request.",
              );
            id = tool.id;
            seenIds.add(id);
            if (ids === undefined) {
              ids = new Map();
              choices.set(choice.index, ids);
            }
            ids.set(tool.index, id);
            update = calls.start(id);
          } else if (tool.id !== undefined && tool.id !== id) {
            throw new Error(
              "Chat Completions tool id changed; preserve each tool's id and index.",
            );
          }
          if (tool.function?.arguments !== undefined) {
            if (finalTexts?.has(id))
              throw new Error(
                "Chat Completions received arguments after a final object; send the object last.",
              );
            const args = tool.function.arguments;
            const finalText = getFinalText?.(args);
            if (finalText === undefined) {
              update = calls.push(id, args);
            } else {
              finalTexts ??= new Map();
              finalTexts.set(id, finalText);
            }
          }
        }
        if (reason != null) {
          for (const id of ids?.values() ?? []) {
            const finalText = finalTexts?.get(id);
            update = calls.complete(id, finalText === undefined ? undefined : () => finalText);
            finalTexts?.delete(id);
          }
          choices.delete(choice.index);
          finishedChoices.add(choice.index);
        }
      }
      return update;
    },
    () => {
      if (choices.size !== 0) {
        throw new Error(
          "Chat Completions ended before finish_reason; consume the complete SDK stream or abort it.",
        );
      }
      clear();
    },
    adapter,
    options,
    clear,
  );
};

export const openAIChatCompletions = (pool = createStructuredStreamPool(), options) =>
  createChatCompletions(pool, options, "openai-chat-completions");
