import type {
  EventStructuredStream,
  StructuredStreamIntegration,
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

export const langchain: StructuredStreamIntegration<
  LangChainToolCallMessage,
  string
>;

export function createStructuredStream(
  pool?: StructuredStreamPool<string>,
): EventStructuredStream<LangChainToolCallMessage, string>;
