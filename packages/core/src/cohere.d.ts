import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

type ToolCall = {
  readonly id?: string | undefined;
  readonly function?: { readonly arguments?: string | undefined } | undefined;
};

export type CohereToolCallEvent =
  | {
      readonly type: "tool-call-start" | "tool-call-delta";
      readonly index?: number | undefined;
      readonly delta?: {
        readonly message?: {
          readonly toolCalls?: ToolCall | undefined;
          readonly tool_calls?: ToolCall | undefined;
        } | undefined;
      } | undefined;
    }
  | { readonly type: "tool-call-end"; readonly index?: number | undefined }
  | {
      readonly type: "message-end";
      readonly delta?: {
        readonly error?: string | undefined;
        readonly finishReason?: string | undefined;
        readonly finish_reason?: string | undefined;
      } | undefined;
    }
  | { readonly type: string }
  | { readonly type: string; readonly [key: string]: unknown };

export const cohere: BatchStructuredStreamIntegration<CohereToolCallEvent, string>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<CohereToolCallEvent, string>;
