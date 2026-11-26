# Gate Realtime function calls on response status

## Problem

Realtime can send both argument and output-item done events for an interrupted
response. Even valid JSON at either event is insufficient to confirm a call.

## Decision

Add `openAIRealtime` to `streamfold/openai`. Use the standard integration
and pool, keyed by the SDK's function `call_id`. Remember each active call's
response ID. Stream argument deltas immediately and reconcile final text only
on a completed response. A response's output, when supplied, identifies its
final calls. Without output, require a closing argument or item event.
An unsuccessful response or truncated call fails the integration and releases
all pending parsers, consistent with the existing provider error contract.

## Verification

Exercise interleaved calls and responses, interruption with complete JSON,
final snapshots, EOF, unrelated server events and cleanup. Compile the public
surface against the official SDK and pass wire frames through its WebSocket
decoder offline. Verify the full repository and the packed public import.
