# Manual provider smoke checks

Status: proposed, 2026-11-19.

## Problem

SDK fixtures verify protocol handling but cannot establish live model support.
The existing examples do not provide a common bounded, pass/fail check for
OpenAI, Anthropic, Groq, and Ollama.

## Decision

Add one example command that prints a request plan by default. Only `--apply`
sends a request, and it refuses execution when `CI` is set. Select the provider
and model explicitly; use the existing fixed provider endpoints and only that
provider's environment credential. Do not accept arbitrary URLs or load files.

Send one synthetic weather-tool request with a 256-token output limit, no
retries, and a 30-second deadline. Reuse the existing SDKs and Streamfold
readers. Require one completed `{ "city": "Paris" }` input and a successful
terminal event. Consume the whole response to observe late failures. Never
execute a tool. Cancel on SIGINT and dispose listeners/timers on every exit.

Print only the plan and aggregate result. Disable SDK logs/tracing and do not
print raw provider errors, headers, arguments, or credentials. No CI workflow,
telemetry, release automation, or automatic live run is added.

## Acceptance and verification

Test every provider through its real SDK and local synthetic HTTP/SSE. Verify
default no-request behavior, credential isolation, token limits, terminal
failures, invalid/missing arguments, no retries, and cancellation/deadline
cleanup. Type-check request shapes and run package/packed-artifact checks.
Live requests require a separate explicit invocation and are not implied by
passing offline tests. Model availability and latency remain unverified.
