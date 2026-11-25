# Parse function arguments from an Agents Runner

## Problem

A streamed Runner result interleaves raw model envelopes, normalized events and
run items. Filtering for tool run items loses incremental arguments. A Chat
Completions parser for a single request also remembers finished choice indexes,
which a later model turn reuses.

## Decision

Expose one structural integration, `openAIAgents` from
`streamfold/openai-agents`. Dispatch only tagged OpenAI model events. Share
the two OpenAI argument handlers and the ordinary integration lifecycle.
Scope Chat Completions bookkeeping to a model turn. Keep tool execution,
handoffs, cancellation of the model request and final output with the Runner.

## Verification

Exercise both SDK decoders through a real Runner with local SSE responses.
Check partial and final arguments, repeated turns, a handoff, failure, abort
and the separate run result. Type-check the public import and run the decoder
tests against the packed package.
