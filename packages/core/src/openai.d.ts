import type {
  EventStructuredStream,
  StructuredStreamIntegration,
  StructuredStreamPool,
} from "./index.js";

export type OpenAiResponsesToolEvent =
  | {
      readonly type: "response.output_item.added";
      readonly item: {
        readonly type: string;
        readonly id: string;
      };
    }
  | {
      readonly type: "response.function_call_arguments.delta";
      readonly item_id: string;
      readonly delta: string;
    }
  | {
      readonly type: "response.function_call_arguments.done";
      readonly item_id: string;
      readonly arguments: string;
    }
  | {
      readonly type: string;
      readonly [key: string]: unknown;
    };

export const openAI: StructuredStreamIntegration<
  OpenAiResponsesToolEvent,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
): EventStructuredStream<OpenAiResponsesToolEvent, string>;
