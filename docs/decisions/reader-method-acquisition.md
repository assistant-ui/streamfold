# Capture readable-source acquisition once

Status: accepted for implementation, 2026-11-19.

## Problem

Managed consumption reads `getReader` for its callable check, then reads it
again to invoke it. An accessor may return a different value or throw on that
second read even though acquiring a reader once works.

## Decision

Capture `getReader` once, then invoke that value with the source as its
receiver using `Reflect.apply`, matching the existing captured iterator-method
pattern. Preserve iterable fallback for absent/non-callable methods. Keep all
reader cancellation, lock release, and error propagation paths unchanged.

## Alternatives and consequences

Repeated lookup changes observable accessor behavior. Binding a new wrapper
is unnecessary. No public API or normal-stream behavior changes; accessor
backed streams gain consistent single acquisition.

## Acceptance and verification

Use real ReadableStreams with observable accessors. Verify one lookup and one
invocation, the receiver, normal EOF, early return, cancellation, source errors,
acquisition errors, and released reader locks/listeners. First prove the new
cases fail on the original code. Run the focused and full suites, packed-runtime
checks, and the contributor-documented managed-read benchmark with parity and
cleanup controls. Make no speedup claim from this correctness fix.

## Iterator factory acquisition

The same invocation rule applies to the selected iterator factory. Invoke it
with the source as its receiver and zero arguments, without reading its
`call` property. A non-callable factory must raise `TypeError` even if it
has a callable `call` property. Verify both protocols against native
`for await` and exercise early return on the acquired iterator.
