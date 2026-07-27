import type {
  EventStructuredStream,
  StructuredStreamIntegration,
  StructuredStreamPool,
} from "./index.js";

export type AssistantUiStreamEvent =
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

export const assistantUI: StructuredStreamIntegration<
  AssistantUiStreamEvent,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
): EventStructuredStream<AssistantUiStreamEvent, string>;
