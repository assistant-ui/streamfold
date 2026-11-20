# Own optional backend registration and teardown

Status: accepted for implementation, 2026-11-19.

## Problem

`initializeAssistantStream()` discards the host's unregister callback. An
application cannot remove its registration on shutdown or hot-module disposal,
and repeated module instances accumulate registrations.

## Decision

Add synchronous `disableAssistantStream(): void` beside the existing
initializer. Each module instance owns one initialization state containing its
pending promise and the host unregister callback. Disabling invalidates that
state before invoking its callback. Before registration, initialization checks
that it still owns the current state, so a disabled pending attempt cannot
register later. An initialization cancelled by disabling resolves to false.
A later initialization starts fresh and may enable the backend again.

Calls within one enabled module remain deduplicated. Disabling is idempotent,
removes only that module's registration, and does not cancel or dispose existing
parsers. Other registrations retain their ordering and ownership. Applications
must call disable during shutdown or their hot-module disposal hook; merely
reimporting a module does not automatically clean an abandoned owner.

## Alternatives and consequences

Do not replace the host registry or remove registrations owned by another
module/package copy. A process-wide singleton would let one caller disable
another caller's backend. Awaiting initialization before disabling allows a
pending registration to become briefly active. State identity permits immediate
cancellation without a global generation counter or additional public options.

The new export is additive. Existing initialization stays opt-in, returns false
for unavailable capabilities, and can retry. The event adapter is unaffected.

## Acceptance and verification

Reproduce retained registrations after teardown before implementation. Verify
repeated disable, enable/disable/re-enable, concurrent initialization, disabling
during Wasm compilation, disable followed immediately by a new initialization,
module reload ownership, preservation of other registrations, and continued
operation of existing native/Wasm parsers. Use the real pinned assistant-stream
preview and test absent peers/capabilities. Update declaration/type coverage,
the public setup examples, and package documentation. Run focused/full tests
and the lifecycle suite against an npm tarball. No browser HMR or performance
claim follows from module-isolation tests.
