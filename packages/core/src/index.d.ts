export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface StreamState {
  /** Number of UTF-8 bytes processed by the Rust parser. */
  readonly bytesSeen: number;
  readonly depth: number;
  readonly complete: boolean;
  readonly inString: boolean;
}

export interface CompletedStructuredStream<Id = string> extends StreamState {
  readonly id: Id;
  readonly text: string;
  readonly value: JsonValue;
}

export type StructuredStreamUpdate<Id = string> =
  | StreamState
  | CompletedStructuredStream<Id>
  | undefined;

export interface EventStructuredStream<Event, Id = string> {
  push(event: Event): StructuredStreamUpdate<Id>;
  finish(): readonly CompletedStructuredStream<Id>[];
}

export interface StructuredStreamIntegration<Event, Id = string> {
  (
    pool?: StructuredStreamPool<Id>,
  ): EventStructuredStream<Event, Id>;
}

export class IncrementalJsonScanner {
  push(chunk: string): StreamState;
  finish(): StreamState;
  dispose(): void;
  readonly backend: "rust-wasm";
  readonly state: StreamState;
}

export class StructuredStreamPool<Id = string> {
  start(id: Id, initialChunk?: string): StreamState;
  push(id: Id, delta: string): StreamState;
  finish(id: Id): CompletedStructuredStream<Id>;
  abort(id: Id): boolean;
  has(id: Id): boolean;
  readonly activeIds: readonly Id[];
  readonly size: number;
}

export function createStructuredStream(): IncrementalJsonScanner;
export function createStructuredStream<Event, Id = string>(
  integration: StructuredStreamIntegration<Event, Id>,
): EventStructuredStream<Event, Id>;
export function createStructuredStreamPool<Id = string>(): StructuredStreamPool<Id>;

export const STREAMFOLD_ENGINE: "rust-wasm";
