export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type StructuredStreamPath = readonly (string | number)[];
export type StructuredStreamFieldState = "partial" | "complete";

export interface StructuredStreamOptions {
  /** Maximum UTF-8 bytes accepted by one stream. Defaults to 16 MiB. */
  readonly maxBytes?: number;
  /** Maximum nested object/array depth. Defaults to 128. */
  readonly maxDepth?: number;
}

export interface StructuredStreamPoolOptions extends StructuredStreamOptions {
  /** Maximum number of concurrently active streams. Defaults to 256. */
  readonly maxActiveStreams?: number;
}

export type StructuredStreamPatch =
  | {
      readonly op: "set";
      readonly path: StructuredStreamPath;
      readonly value: JsonValue;
    }
  | {
      readonly op: "append";
      readonly path: StructuredStreamPath;
      readonly value: string;
    }
  | {
      readonly op: "complete";
      readonly path: StructuredStreamPath;
    };

export interface StreamState {
  /** Number of UTF-8 bytes processed by the Rust parser. */
  readonly bytesSeen: number;
  readonly depth: number;
  readonly complete: boolean;
  readonly inString: boolean;
  readonly changes: readonly StructuredStreamPatch[];
  /** A live view updated in place; use `changes` for reactive state updates. */
  readonly partialValue: JsonValue | undefined;
}

export interface CompletedStructuredStream<Id = string> extends StreamState {
  readonly id: Id;
  readonly text: string;
  readonly value: JsonValue;
}

export interface ActiveStructuredStream<Id = string> extends StreamState {
  readonly id: Id;
}

export type StructuredStreamUpdate<Id = string> =
  | ActiveStructuredStream<Id>
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
  constructor(options?: StructuredStreamOptions);
  push(chunk: string): StreamState;
  finish(): StreamState;
  getFieldState(path: StructuredStreamPath): StructuredStreamFieldState;
  dispose(): void;
  readonly backend: "rust-wasm";
  readonly state: StreamState;
  /** A live view updated in place; use `StreamState.changes` for reactive updates. */
  readonly value: JsonValue | undefined;
}

export class StructuredStreamPool<Id = string> {
  constructor(options?: StructuredStreamPoolOptions);
  start(id: Id, initialChunk?: string): ActiveStructuredStream<Id>;
  push(id: Id, delta: string): ActiveStructuredStream<Id>;
  finish(id: Id): CompletedStructuredStream<Id>;
  getFieldState(
    id: Id,
    path: StructuredStreamPath,
  ): StructuredStreamFieldState;
  abort(id: Id): boolean;
  has(id: Id): boolean;
  readonly activeIds: readonly Id[];
  readonly size: number;
}

export function createStructuredStream(): IncrementalJsonScanner;
export function createStructuredStream(
  options: StructuredStreamOptions,
): IncrementalJsonScanner;
export function createStructuredStream<Event, Id = string>(
  integration: StructuredStreamIntegration<Event, Id>,
): EventStructuredStream<Event, Id>;
export function createStructuredStreamPool<Id = string>(
  options?: StructuredStreamPoolOptions,
): StructuredStreamPool<Id>;

export const STREAMFOLD_ENGINE: "rust-wasm";
export const DEFAULT_STREAM_LIMITS: Readonly<
  Required<StructuredStreamPoolOptions>
>;
