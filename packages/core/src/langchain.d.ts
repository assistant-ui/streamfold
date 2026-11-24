import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamIntegrationOptions,
  StructuredStreamPool,
} from "./index.js";

export interface LangChainToolCallChunk {
  readonly type?: string | undefined;
  readonly index?: number | string | undefined;
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly args?: string | undefined;
}

export interface LangChainToolCallMessage {
  readonly tool_call_chunks?: readonly LangChainToolCallChunk[] | undefined;
}

export const langchain: BatchStructuredStreamIntegration<
  LangChainToolCallMessage,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
  options?: StructuredStreamIntegrationOptions,
): BatchEventStructuredStream<LangChainToolCallMessage, string>;
