# Consume Pi's native tool events

The Pi provider decoders expose one AssistantMessageEvent protocol. Add one
Streamfold entry for that protocol. Like the Anthropic adapter, it maps a
content index to a call ID and sends fragments to the existing pool. Unlike
Anthropic, Pi supplies the final arguments object at toolcall_end, including
for providers that never send a delta. Use that object to finish the call.
A toolCall carrying argumentsError represents a decoding failure.

An open call requires its toolcall_end even if its last preview is valid JSON.
A later message error or length limit still fails the read. Callers deciding
whether to execute tools must consume the message outcome. Use the managed
reader's cancellation and disposal and pass its signal to the Pi producer.

Verify the public export against the native SDK types, both provider decoders
with injected SSE, interleaved calls, terminal failures, and early exit.
Exercise the built tarball with and without the SDK installed.
