# Read native OpenRouter chat chunks

## Problem

The OpenRouter SDK decodes the wire fields `delta.tool_calls` and
`finish_reason` as `delta.toolCalls` and `finishReason`. Feeding those
chunks directly to the OpenAI Chat Completions adapter loses the tool updates.

## Decision

Expose `openRouter` at `streamfold/openrouter` with structural input types.
Select the two field names inside the shared Chat Completions implementation.
Keeping the decoded chunk intact preserves the provider error and the choice
that caused a terminal failure. Both adapters use the managed reader's existing
pool, cancellation and disposal behavior.

## Verification

Run offline SSE through the native SDK for interleaved tool arguments, provider
errors, truncated responses, and cancellation. Check the SDK's inferred stream
type and run the fixtures through a packed Streamfold install. Pin the newest
compatible dev SDK allowed by the repository's 24-hour release-age policy.
