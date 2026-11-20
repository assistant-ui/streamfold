# Release SDK bookkeeping on disposal

Status: accepted for implementation, 2026-11-19.

## Problem

Managed sessions release their parser pools but retained integration objects
still hold call-index maps and completed-ID sets. Five adapters omit the
existing active-state cleanup callback. Completion deduplication state is not
included in shared disposal.

## Decision

Use each adapter's existing cleanup callback to clear its index map, plus
LangChain's empty-argument set. Include completed IDs in the shared disposal
state and clear them only when the managed session disposes. Keep deduplication
across active batches, standalone completion history, terminal failure
semantics, and previously returned values unchanged. No public API is added.

## Alternatives and consequences

Do not add public diagnostics or a second bookkeeping registry. Constructor
scoped Map/Set instrumentation in tests observes retained entries without heap
thresholds or changing event consumption. Collections remain live throughout
consumption and must be empty after disposal; this is a lifecycle guarantee,
not a measured memory or timing improvement.

## Acceptance and verification

First reproduce retained state on early return, abort, source failure, invalid
final JSON, and normal EOF. Verify valid final values, empty parser pools,
upstream closure, and duplicate completion suppression during consumption.
Check direct integration parser failure and preserved manual completion history.
Run focused tests, the full check, and the same regression suite against an
extracted npm tarball. No benchmark claim or provider request is required.
