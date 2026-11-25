import type { BatchStructuredStreamIntegration } from "./index.js";

/** A decoded CompletionEvent from Mistral chat.stream. */
export interface MistralChatEvent {
  readonly data: {
    readonly choices: readonly {
      readonly index: number;
      readonly finishReason: string | null;
      readonly delta: {
        readonly toolCalls?:
          | readonly {
              readonly index?: number | undefined;
              readonly id?: string | undefined;
              readonly type?: string | undefined;
              readonly function: {
                readonly name: string;
                readonly arguments: string | Readonly<Record<string, unknown>>;
              };
            }[]
          | null
          | undefined;
      };
    }[];
  };
}

/** Parse function tool inputs from one Mistral chat.stream request. */
export const mistralChat: BatchStructuredStreamIntegration<MistralChatEvent, string>;
export { mistralChat as createStructuredStream };
