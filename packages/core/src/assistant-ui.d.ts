import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

export type AssistantUiStreamEvent =
  | {
      readonly type: "step-finish" | "message-finish";
      readonly path: readonly number[];
      readonly finishReason: string;
    }
  | {
      readonly type: "error";
      readonly path: readonly number[];
      readonly error: string;
      readonly code?: string;
      readonly severity?: "critical" | "warning" | "info";
    }
  | {
      readonly type: "part-start";
      readonly path: readonly number[];
      readonly part:
        | {
            readonly type: "tool-call";
            readonly toolCallId: string;
            readonly toolName: string;
          }
        | { readonly type: string };
    }
  | {
      readonly type: "text-delta";
      readonly path: readonly number[];
      readonly textDelta: string;
    }
  | {
      readonly type: "tool-call-args-text-finish";
      readonly path: readonly number[];
    }
  | {
      readonly type: string;
      readonly path: readonly number[];
      readonly [key: string]: unknown;
    };

export const assistantUI: BatchStructuredStreamIntegration<
  AssistantUiStreamEvent,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<AssistantUiStreamEvent, string>;
