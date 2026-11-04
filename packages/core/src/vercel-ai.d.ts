import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
  StructuredStreamOptions,
  JsonValue,
} from "./index.js";

export type VercelAiToolInputEvent =
  | {
      readonly type: "abort";
      readonly reason?: string | undefined;
    }
  | {
      readonly type: "finish-step" | "finish";
      readonly finishReason?: string | undefined;
    }
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
      readonly type: "tool-input-available" | "tool-call";
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

export type ToolInputParserOptions = Pick<StructuredStreamOptions, "maxBytes" | "maxDepth">;

export interface ToolInputParser {
  /** Consume a JSON delta and return a stable, deeply frozen partial value. */
  push(delta: string): JsonValue | undefined;
  /** Release the parser when its host completes, resets, or cancels the input. */
  dispose(): void;
}

/** Create a parser for generic Vercel AI SDK and Harness tool-input hooks. */
export function createToolInputParser(options?: ToolInputParserOptions): ToolInputParser;
