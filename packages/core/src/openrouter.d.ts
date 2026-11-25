import type { BatchStructuredStreamIntegration } from "./index.js";

/** A decoded chunk from OpenRouter's streaming chat.send request. */
export type OpenRouterChatEvent = {
  readonly choices: readonly {
    readonly index: number;
    readonly finishReason: string | null;
    readonly delta: {
      readonly content?: string | null | undefined;
      readonly toolCalls?:
        | readonly {
            readonly index: number;
            readonly id?: string | undefined;
            readonly type?: string | undefined;
            readonly function?:
              | {
                  readonly arguments?: string | undefined;
                  readonly name?: string | undefined;
                }
              | undefined;
          }[]
        | undefined;
    };
  }[];
  readonly error?: { readonly message: string } | undefined;
};

/** Parse streamed function arguments from one native OpenRouter chat request. */
export const openRouter: BatchStructuredStreamIntegration<OpenRouterChatEvent, string>;
export { openRouter as createStructuredStream };
