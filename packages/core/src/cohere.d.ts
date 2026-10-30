import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

type ToolCall = {
  readonly id?: string;
  readonly function?: { readonly arguments?: string };
};

export type CohereToolCallEvent =
  | {
      readonly type: "tool-call-start" | "tool-call-delta";
      readonly index?: number;
      readonly delta?: {
        readonly message?: { readonly toolCalls?: ToolCall; readonly tool_calls?: ToolCall };
      };
    }
  | { readonly type: "tool-call-end"; readonly index?: number }
  | { readonly type: string }
  | { readonly type: string; readonly [key: string]: unknown };

export const cohere: BatchStructuredStreamIntegration<CohereToolCallEvent, string>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<CohereToolCallEvent, string>;
