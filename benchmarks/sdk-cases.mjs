import { createStructuredStream as createAgUiStream } from "streamfold/ag-ui";
import { createStructuredStream as createAnthropicStream } from "streamfold/anthropic";
import { createStructuredStream as createAssistantUiStream } from "streamfold/assistant-ui";
import { createStructuredStream as createGeminiStream } from "streamfold/gemini";
import { createStructuredStream as createLangChainStream } from "streamfold/langchain";
import { createStructuredStream as createOpenAiStream } from "streamfold/openai";
import { createStructuredStream as createVercelAiStream } from "streamfold/vercel-ai";

const interleave = (inputs, createEvent) => {
  const events = [];
  const rounds = Math.max(...inputs.map((input) => input.chunks.length));
  for (let round = 0; round < rounds; round++) {
    for (const input of inputs) {
      const delta = input.chunks[round];
      if (delta !== undefined) events.push(createEvent(input, delta));
    }
  }
  return events;
};

export const createToolInputs = ({
  calls,
  targetBytes,
  chunkSize,
}) => {
  const inputs = [];
  for (let call = 0; call < calls; call++) {
    const rows = [];
    const rowCount = Math.max(1, Math.floor(targetBytes / calls / 86));
    for (let index = 0; index < rowCount; index++) {
      rows.push({
        id: `${call}-${index}`,
        title: `Task ${index} for agent ${call}`,
        status: index % 3 === 0 ? "queued" : "ready",
        labels: ["benchmark", `agent-${call}`],
      });
    }

    const value = {
      project: `streamfold-${call}`,
      operation: "create_tasks",
      rows,
      options: { notify: false, source: "sdk-adapter-benchmark" },
    };
    const text = JSON.stringify(value);
    const chunks = [];
    for (let offset = 0; offset < text.length; offset += chunkSize) {
      chunks.push(text.slice(offset, offset + chunkSize));
    }
    inputs.push({
      id: `call-${call}`,
      index: call,
      path: [call],
      text,
      value,
      chunks,
    });
  }
  return inputs;
};

export const createSdkCases = (inputs) => [
  {
    name: "assistant-stream",
    createAdapter: createAssistantUiStream,
    events: [
      ...inputs.map((input) => ({
        type: "part-start",
        path: input.path,
        part: {
          type: "tool-call",
          toolCallId: input.id,
          toolName: "create_tasks",
        },
      })),
      ...interleave(inputs, (input, delta) => ({
        type: "text-delta",
        path: input.path,
        textDelta: delta,
      })),
      ...inputs.map((input) => ({
        type: "tool-call-args-text-finish",
        path: input.path,
      })),
    ],
  },
  {
    name: "Vercel AI SDK fullStream",
    createAdapter: createVercelAiStream,
    events: [
      ...inputs.map((input) => ({
        type: "tool-input-start",
        id: input.id,
        toolName: "create_tasks",
      })),
      ...interleave(inputs, (input, delta) => ({
        type: "tool-input-delta",
        id: input.id,
        delta,
      })),
      ...inputs.map((input) => ({
        type: "tool-input-end",
        id: input.id,
      })),
    ],
  },
  {
    name: "Vercel AI SDK UIMessage",
    createAdapter: createVercelAiStream,
    events: [
      ...inputs.map((input) => ({
        type: "tool-input-start",
        toolCallId: input.id,
        toolName: "create_tasks",
      })),
      ...interleave(inputs, (input, delta) => ({
        type: "tool-input-delta",
        toolCallId: input.id,
        inputTextDelta: delta,
      })),
      ...inputs.map((input) => ({
        type: "tool-input-available",
        toolCallId: input.id,
        toolName: "create_tasks",
        input: input.value,
      })),
    ],
  },
  {
    name: "OpenAI Responses",
    createAdapter: createOpenAiStream,
    events: [
      ...inputs.map((input) => ({
        type: "response.output_item.added",
        output_index: input.index,
        item: {
          type: "function_call",
          id: input.id,
          call_id: input.id,
          name: "create_tasks",
          arguments: "",
        },
      })),
      ...interleave(inputs, (input, delta) => ({
        type: "response.function_call_arguments.delta",
        item_id: input.id,
        output_index: input.index,
        delta,
      })),
      ...inputs.map((input) => ({
        type: "response.function_call_arguments.done",
        item_id: input.id,
        output_index: input.index,
        name: "create_tasks",
        arguments: input.text,
      })),
    ],
  },
  {
    name: "Anthropic Messages",
    createAdapter: createAnthropicStream,
    events: [
      ...inputs.map((input) => ({
        type: "content_block_start",
        index: input.index,
        content_block: {
          type: "tool_use",
          id: input.id,
          name: "create_tasks",
          input: {},
        },
      })),
      ...interleave(inputs, (input, delta) => ({
        type: "content_block_delta",
        index: input.index,
        delta: { type: "input_json_delta", partial_json: delta },
      })),
      ...inputs.map((input) => ({
        type: "content_block_stop",
        index: input.index,
      })),
    ],
  },
  {
    name: "AG-UI",
    createAdapter: createAgUiStream,
    events: [
      ...inputs.map((input) => ({
        type: "TOOL_CALL_START",
        toolCallId: input.id,
        toolCallName: "create_tasks",
      })),
      ...interleave(inputs, (input, delta) => ({
        type: "TOOL_CALL_ARGS",
        toolCallId: input.id,
        delta,
      })),
      ...inputs.map((input) => ({
        type: "TOOL_CALL_END",
        toolCallId: input.id,
      })),
    ],
  },
  {
    name: "Google Gemini Interactions",
    createAdapter: createGeminiStream,
    events: [
      ...inputs.map((input) => ({
        event_type: "step.start",
        index: input.index,
        step: {
          type: "function_call",
          id: input.id,
          name: "create_tasks",
          arguments: "",
        },
      })),
      ...interleave(inputs, (input, delta) => ({
        event_type: "step.delta",
        index: input.index,
        delta: { type: "arguments", partial_arguments: delta },
      })),
      { event_type: "interaction.completed" },
    ],
  },
  {
    name: "LangChain AIMessageChunk",
    createAdapter: createLangChainStream,
    events: interleave(inputs, (input, delta) => {
      const first = delta === input.chunks[0];
      return {
        tool_call_chunks: [
          {
            type: "tool_call_chunk",
            index: input.index,
            id: first ? input.id : undefined,
            name: first ? "create_tasks" : undefined,
            args: delta,
          },
        ],
      };
    }),
  },
];
