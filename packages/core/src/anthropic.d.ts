import type {
  EventStructuredStream,
  StructuredStreamIntegration,
  StructuredStreamPool,
} from "./index.js";

export type AnthropicToolInputEvent =
  | {
      readonly type: "content_block_start";
      readonly index: number;
      readonly content_block: {
        readonly type: string;
        readonly id: string;
      };
    }
  | {
      readonly type: "content_block_delta";
      readonly index: number;
      readonly delta:
        | {
            readonly type: "input_json_delta";
            readonly partial_json: string;
          }
        | { readonly type: string };
    }
  | {
      readonly type: "content_block_stop";
      readonly index: number;
    }
  | {
      readonly type: string;
      readonly index?: number;
      readonly [key: string]: unknown;
    };

export const anthropic: StructuredStreamIntegration<
  AnthropicToolInputEvent,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
): EventStructuredStream<AnthropicToolInputEvent, string>;
