import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

export type OpenAiResponsesToolEvent =
  | {
      readonly type: "response.output_item.added";
      readonly item: {
        readonly type: string;
        readonly id: string;
      };
    }
  | {
      readonly type: "response.function_call_arguments.delta";
      readonly item_id: string;
      readonly delta: string;
    }
  | {
      readonly type: "response.function_call_arguments.done";
      readonly item_id: string;
      readonly arguments: string;
    }
  | { readonly type: string }
  | {
      readonly type: string;
      readonly [key: string]: unknown;
    };

export const openAI: BatchStructuredStreamIntegration<
  OpenAiResponsesToolEvent,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<OpenAiResponsesToolEvent, string>;

/** Structural input for decoded Chat Completions chunks, not raw SSE bytes. */
export type OpenAiChatCompletionsEvent =
  | {
      readonly choices: readonly {
        readonly index: number;
        readonly finish_reason?: string | null | undefined;
        readonly delta: {
          readonly content?: string | null | undefined;
          readonly function_call?: unknown;
          readonly tool_calls?: readonly {
            readonly index: number;
            readonly id?: string | undefined;
            readonly type?: string | undefined;
            readonly function?: {
              readonly name?: string | undefined;
              readonly arguments?: string | undefined;
            } | undefined;
            readonly custom?: unknown;
          }[] | undefined;
        };
      }[];
    }
  | { readonly error: Error | { readonly message?: string | undefined } };

/**
 * Parse function tool arguments from one Chat Completions request.
 * Completes a choice on `tool_calls` or `stop`; rejects truncated EOF and
 * failed choices. Non-function tools, text, and usage chunks are ignored.
 * Use `openAI` for Responses events. This adapter never executes tools.
 * @example
 * for await (const update of readStructured(chunks, { integration: openAIChatCompletions })) {
 *   renderInput(update.id, update.partialValue);
 * }
 */
export const openAIChatCompletions: BatchStructuredStreamIntegration<
  OpenAiChatCompletionsEvent,
  string
>;

type RealtimeItem =
  | {
      readonly type: "function_call";
      readonly call_id?: string | undefined;
      readonly arguments: string;
      readonly status?: string | undefined;
    }
  | { readonly type: "message" | "function_call_output" | `mcp_${string}` };

/** Decoded Realtime server events. The SDK remains optional at runtime. */
export type OpenAiRealtimeEvent =
  | {
      readonly type: "response.output_item.added" | "response.output_item.done";
      readonly response_id: string;
      readonly item: RealtimeItem;
    }
  | {
      readonly type: "response.function_call_arguments.delta";
      readonly response_id: string;
      readonly call_id: string;
      readonly delta: string;
    }
  | {
      readonly type: "response.function_call_arguments.done";
      readonly response_id: string;
      readonly call_id: string;
      readonly arguments: string;
    }
  | {
      readonly type: "response.done";
      readonly response: {
        readonly id?: string | undefined;
        readonly status?: string | undefined;
        readonly output?: readonly RealtimeItem[] | undefined;
        readonly status_details?: unknown;
      };
    }
  | { readonly type: "error"; readonly error: { readonly message: string } }
  | {
      readonly type:
        | "response.created"
        | `response.${"output_text" | "output_audio" | "output_audio_transcript" | "content_part" | "mcp_call" | "mcp_call_arguments"}.${string}`
        | `${"session" | "conversation" | "input_audio_buffer" | "output_audio_buffer" | "rate_limits" | "mcp_list_tools"}.${string}`;
    };

/** Preview function arguments on deltas and complete them on a successful response.done. */
export const openAIRealtime: BatchStructuredStreamIntegration<OpenAiRealtimeEvent, string>;
