import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

export type PiToolCallEvent =
  | {
      readonly type: "toolcall_start";
      readonly contentIndex: number;
      readonly partial: {
        readonly content: readonly (
          | { readonly type: "toolCall"; readonly id: string }
          | { readonly type: "text" | "thinking" }
        )[];
      };
    }
  | { readonly type: "toolcall_delta"; readonly contentIndex: number; readonly delta: string }
  | {
      readonly type: "toolcall_end";
      readonly contentIndex: number;
      readonly toolCall: {
        readonly id: string;
        readonly arguments: object;
        readonly argumentsError?: string | undefined;
      };
    }
  | {
      readonly type: "error";
      readonly reason: "aborted" | "error";
      readonly error: { readonly errorMessage?: string | undefined };
    }
  | { readonly type: "done"; readonly reason: string }
  | {
      readonly type:
        | "start"
        | "text_start"
        | "text_delta"
        | "text_end"
        | "thinking_start"
        | "thinking_delta"
        | "thinking_end";
    };

export const pi: BatchStructuredStreamIntegration<PiToolCallEvent, string>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<PiToolCallEvent, string>;
