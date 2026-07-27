import type {
  EventStructuredStream,
  StructuredStreamIntegration,
  StructuredStreamPool,
} from "./index.js";

export type AgUiToolCallEvent =
  | {
      readonly type: "TOOL_CALL_START";
      readonly toolCallId: string;
    }
  | {
      readonly type: "TOOL_CALL_ARGS";
      readonly toolCallId: string;
      readonly delta: string;
    }
  | {
      readonly type: "TOOL_CALL_END";
      readonly toolCallId: string;
    }
  | {
      readonly type: string;
      readonly toolCallId?: string;
      readonly [key: string]: unknown;
    };

export const agUI: StructuredStreamIntegration<AgUiToolCallEvent, string>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
): EventStructuredStream<AgUiToolCallEvent, string>;
