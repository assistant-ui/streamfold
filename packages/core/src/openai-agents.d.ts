import type { BatchStructuredStreamIntegration } from "./index.js";

/** Structural subset of the Runner's RunStreamEvent union. */
export type OpenAIAgentsEvent =
  | {
      readonly type: "raw_model_stream_event";
      readonly source?: string | undefined;
      readonly data: { readonly type: string; readonly event?: unknown };
    }
  | { readonly type: "agent_updated_stream_event" | "run_item_stream_event" };

/** Parse OpenAI function arguments across the model turns of one streamed run. */
export const openAIAgents: BatchStructuredStreamIntegration<OpenAIAgentsEvent, string>;

export { openAIAgents as createStructuredStream };
