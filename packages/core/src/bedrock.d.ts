import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

export type BedrockToolCallEvent =
  | {
      readonly contentBlockStart?: {
        readonly contentBlockIndex?: number | undefined;
        readonly start?: {
          readonly toolUse?: { readonly toolUseId?: string | undefined } | undefined;
        } | undefined;
      } | undefined;
      readonly contentBlockDelta?: {
        readonly contentBlockIndex?: number | undefined;
        readonly delta?: {
          readonly toolUse?: { readonly input?: string | undefined } | undefined;
        } | undefined;
      } | undefined;
      readonly contentBlockStop?: { readonly contentBlockIndex?: number | undefined } | undefined;
    }
  | { readonly [key: string]: unknown };

export const bedrock: BatchStructuredStreamIntegration<BedrockToolCallEvent, string>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<BedrockToolCallEvent, string>;
