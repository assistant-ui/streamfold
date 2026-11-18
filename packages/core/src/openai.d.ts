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
        readonly finish_reason?: string | null;
        readonly delta: {
          readonly content?: string | null;
          readonly function_call?: unknown;
          readonly tool_calls?: readonly {
            readonly index: number;
            readonly id?: string;
            readonly type?: string;
            readonly function?: {
              readonly name?: string;
              readonly arguments?: string;
            };
            readonly custom?: unknown;
          }[];
        };
      }[];
    }
  | { readonly error: Error | { readonly message?: string } };

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
