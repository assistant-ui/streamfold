# Decode Mistral chat tool calls

Status: proposed for the unreleased adapter.

## Problem and scope

Mistral 3.4.0 chat.stream yields CompletionEvent frames. Its decoder puts
camelCase choices under frame.data, defaults a missing tool ID to the literal
string "null", and accepts a JSON object or a string for function arguments.
The Responses example consumes a different API.

## Decision

Expose mistralChat from streamfold/mistral. Normalize frames inside the shared
Chat Completions integration so failures, parser disposal, choice completion,
and managed cancellation follow the existing adapter. Each choice/tool index
pair starts with a unique, nonempty provider ID. A repeated matching ID or the
decoder placeholder can continue that pair. Reject an unknown placeholder,
a changed ID, or reuse at another pair. A whole argument object supersedes
earlier fragments and seals that call's arguments. Emit its completion only
on a successful choice finish. A failed finish or open call at EOF is terminal.

## Verification

Feed local SSE responses through the pinned SDK. Exercise interleaved choices
and calls, identity failures, object replacement, truncation, and abort during
a pending body read. Type-check the SDK return type against the public subpath.
Run the Responses controls, package checks, and the decoder suite against an
installed npm tarball. Provider access and credentials are unnecessary.
