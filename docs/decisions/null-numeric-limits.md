# Default numeric limits only when undefined

JavaScript and JSON callers can supply `null` for a numeric limit. The
documented contract accepts positive integers, but nullish coalescing silently
selects the default for these callers.

Use the default for an omitted or `undefined` limit. Let the existing integer
validator report `null` alongside any other invalid options. Apply this in the
shared limit reader so each entry point continues to validate its own keys.

Verify rejection through scanner, pool, adapter, managed reader, and tool-input
parser entry points. Check omitted and undefined limits against the defaults,
then run the package suite and exercise the packed exports.
