import type {
  BatchEventStructuredStream,
  BatchStructuredStreamIntegration,
  StructuredStreamPool,
} from "./index.js";

export interface LangChainToolCallChunk {
  readonly type?: string;
  readonly index: number | string;
  readonly id?: string;
  readonly name?: string;
  readonly args?: string;
}

export interface LangChainToolCallMessage {
  readonly tool_call_chunks?: readonly LangChainToolCallChunk[];
}

export const langchain: BatchStructuredStreamIntegration<
  LangChainToolCallMessage,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
): BatchEventStructuredStream<LangChainToolCallMessage, string>;
