# Isolate compatible-provider credentials

Status: accepted for implementation, 2026-11-19.

## Problem

The OpenAI SDK reads `OPENAI_CUSTOM_HEADERS`, `OPENAI_ORG_ID`,
`OPENAI_PROJECT_ID`, and `OPENAI_ADMIN_KEY` even with an explicit provider key
and base URL. A custom Authorization header can override the Groq key or the
Ollama placeholder. These examples must not forward OpenAI credentials or
routing metadata to another provider.

## Decision

Refuse to construct a compatible-provider client when nonblank
`OPENAI_CUSTOM_HEADERS` is set, with an error instructing the caller to unset
it. The pinned SDK has no public option to disable its environment-header
merge. Explicitly set organization, project, and admin credentials to null.
Keep the fixed endpoints and existing provider-key validation.

The same factory protects the manual smoke command before its SDK client is
copied. Do not mutate process environment, modify SDK internals, or parse and
filter arbitrary custom headers. Applications needing custom routing can
continue to pass their own configured client to `streamWeather`.

## Alternatives and consequences

Passing empty default headers does not suppress the SDK environment headers.
Removing headers after request construction can interfere with SDK defaults,
and clearing process environment would affect concurrent clients. Refusing
this ambiguous configuration prevents a request and adds a setup requirement
for users who previously relied on ambient custom headers.

## Acceptance and verification

Regression tests must fail on the original factory and pass after the fix:
nonblank custom headers fail before fetch for both providers and the manual
smoke command; empty headers remain usable; tenant/admin environment settings
do not enter direct or copied client requests. Use dummy credentials and the
real SDK with injected transport, including the existing local HTTP smoke
fixtures. Run focused tests, type checks, the full check, and package checks.
No live provider requests or performance claims are required.
