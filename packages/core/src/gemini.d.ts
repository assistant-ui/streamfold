import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

export type GeminiToolCallEvent =
  | {
      readonly event_type: "step.start";
      readonly index: number;
      readonly step: {
        readonly type: string;
        readonly id: string;
        readonly arguments?: string | object;
      };
    }
  | {
      readonly event_type: "step.delta";
      readonly index: number;
      readonly delta:
        | {
            readonly type: "arguments";
            readonly partial_arguments: string;
          }
        | { readonly type: string };
    }
  | {
      readonly event_type: "interaction.completed" | "interaction.complete";
    }
  | {
      readonly event_type: string;
      readonly [key: string]: unknown;
    };

export const gemini: BatchStructuredStreamIntegration<
  GeminiToolCallEvent,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<GeminiToolCallEvent, string>;
