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
  /** Live views by default; immutable snapshots are frozen with structural sharing. */
  readonly snapshots?: "live" | "immutable";
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
  /** Live by default; a stable, deeply frozen value with `snapshots: "immutable"`. */
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

export type StructuredStreamLifecycleUpdate<Id = string> =
  | (ActiveStructuredStream<Id> & { readonly type: "start" | "update" })
  | (CompletedStructuredStream<Id> & { readonly type: "complete" });

export interface BatchEventStructuredStream<Event, Id = string>
  extends EventStructuredStream<Event, Id> {
  /** Consume once and return every call update, in event order. */
  pushAll(event: Event): readonly StructuredStreamLifecycleUpdate<Id>[];
}

export interface StructuredStreamIntegration<Event, Id = string> {
  (pool?: StructuredStreamPool<Id>): EventStructuredStream<Event, Id>;
}

export interface BatchStructuredStreamIntegration<Event, Id = string> {
  (pool?: StructuredStreamPool<Id>): BatchEventStructuredStream<Event, Id>;
}

export type StructuredStreamOperation<Id = string> =
  | { readonly type: "start"; readonly id: Id }
  | { readonly type: "delta"; readonly id: Id; readonly text: string }
  | { readonly type: "end"; readonly id: Id }
  | { readonly type: "abort"; readonly id: Id };

/** Translate one decoded event into zero or more ordered operations. */
export type StructuredStreamMapper<Event, Id = string> = (
  event: Event,
) => readonly StructuredStreamOperation<Id>[];

export interface BatchStructuredStream<Event, Id = string> {
  pushAll(event: Event): readonly StructuredStreamLifecycleUpdate<Id>[];
  /** Finalize remaining calls only. Repeated successful calls return []. */
  finish(): readonly (CompletedStructuredStream<Id> & {
    readonly type: "complete";
  })[];
  /** Release active parsers without finalizing their JSON. Idempotent. */
  dispose(): void;
}

/** Calling the adapter creates an independent parser pool. */
export interface StructuredStreamAdapter<Event, Id = string> {
  (options?: StructuredStreamPoolOptions): BatchStructuredStream<Event, Id>;
}

export function defineAdapter<Event, Id = string>(
  mapEvent: StructuredStreamMapper<Event, Id>,
): StructuredStreamAdapter<Event, Id>;

export interface ReadStructuredOptions<Event, Id = string> {
  readonly adapter: StructuredStreamAdapter<Event, Id>;
  readonly integration?: never;
  readonly limits?: StructuredStreamPoolOptions;
}

export interface ReadStructuredIntegrationOptions<Event, Id = string> {
  readonly integration: BatchStructuredStreamIntegration<Event, Id>;
  readonly adapter?: never;
  readonly limits?: StructuredStreamPoolOptions;
}

/** Consume decoded events, finalizing at EOF and disposing on every exit. */
export function readStructured<Event, Id = string>(
  events: AsyncIterable<Event> | Iterable<Event>,
  options:
    | ReadStructuredOptions<Event, Id>
    | ReadStructuredIntegrationOptions<Event, Id>,
): AsyncGenerator<StructuredStreamLifecycleUpdate<Id>, void, unknown>;

export class IncrementalJsonScanner {
  constructor(options?: StructuredStreamOptions);
  push(chunk: string): StreamState;
  finish(): StreamState;
  getFieldState(path: StructuredStreamPath): StructuredStreamFieldState;
  dispose(): void;
  readonly backend: "rust-wasm";
  readonly state: StreamState;
  /** Live by default; a stable, deeply frozen value with `snapshots: "immutable"`. */
  readonly value: JsonValue | undefined;
}

export class StructuredStreamPool<Id = string> {
  constructor(options?: StructuredStreamPoolOptions);
  start(id: Id, initialChunk?: string): ActiveStructuredStream<Id>;
  push(id: Id, delta: string): ActiveStructuredStream<Id>;
  finish(id: Id): CompletedStructuredStream<Id>;
  getFieldState(id: Id, path: StructuredStreamPath): StructuredStreamFieldState;
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
  adapter: StructuredStreamAdapter<Event, Id>,
): BatchStructuredStream<Event, Id>;
export function createStructuredStream<Event, Id = string>(
  integration: BatchStructuredStreamIntegration<Event, Id>,
): BatchEventStructuredStream<Event, Id>;
export function createStructuredStream<Event, Id = string>(
  integration: StructuredStreamIntegration<Event, Id>,
): EventStructuredStream<Event, Id>;
export function createStructuredStreamPool<Id = string>(
  options?: StructuredStreamPoolOptions,
): StructuredStreamPool<Id>;

export const STREAMFOLD_ENGINE: "rust-wasm";
export const DEFAULT_STREAM_LIMITS: Readonly<
  Required<Pick<StructuredStreamPoolOptions, "maxBytes" | "maxDepth" | "maxActiveStreams">>
>;
