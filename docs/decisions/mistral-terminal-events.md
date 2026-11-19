# Preserve Mistral incomplete-response details

Status: proposed, 2026-11-19.

## Problem

The pinned Mistral 3.4.0 SDK converts `incomplete_details` to
`incompleteDetails`. The maintained example forwards that response unchanged,
but the reused OpenAI adapter reads `incomplete_details`. Real SDK regression
tests reproduce the missing reason and `cause`; failed responses and ordinary
error events already propagate correctly.

## Decision

Normalize only this field for `response.incomplete` in `examples/mistral.mjs`,
alongside its existing item-ID conversion. Keep parsing, terminal errors, and
iterator cleanup in the existing managed reader and OpenAI adapter. Do not add
a provider subpath or change the core adapter's contract.

## Acceptance and verification

Through the real SDK SSE decoder, preserve both supported incomplete reasons
and a null reason as the thrown error's cause. Failed and error events retain
their messages. Every failure closes the SDK source and discards pending calls
without producing completion updates, even when the buffered JSON is valid.
Keep the interleaved success and early-return controls, type-check SDK usage,
and run the full checks plus the tests against a packed package. No live model
request is required or claimed.
