import type { StructuredStreamAdapter, StructuredStreamOperation } from "./index.js";

export interface AdapterContractTest {
  readonly name: string;
  run(): Promise<void>;
}

/** Node-only helpers for node:test, Vitest, and other Node-based test runners. */
export function adapterContractTests<Event>(options: {
  readonly adapter: StructuredStreamAdapter<Event, string>;
  /** Encode every operation in order; may split or batch your decoded events. */
  readonly encode: (operations: readonly StructuredStreamOperation<string>[]) => Iterable<Event>;
}): readonly AdapterContractTest[];
