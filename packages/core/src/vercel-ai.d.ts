import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

export type VercelAiToolInputEvent =
  | {
      readonly type: "tool-input-start";
      readonly id: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool-input-start";
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool-input-delta";
      readonly id: string;
      readonly delta: string;
    }
  | {
      readonly type: "tool-input-delta";
      readonly toolCallId: string;
      readonly inputTextDelta: string;
    }
  | {
      readonly type: "tool-input-end";
      readonly id: string;
    }
  | {
      readonly type: "tool-input-available";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | {
      readonly type: string;
      readonly id?: string;
      readonly toolCallId?: string;
      readonly [key: string]: unknown;
    };

export const vercelAI: BatchStructuredStreamIntegration<
  VercelAiToolInputEvent,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<VercelAiToolInputEvent, string>;
