import type { SubscriptionOptions } from './index.js';

export interface ImmediateStore<TSnapshot> {
  get(): TSnapshot;
  /** SDK stores publish the current value synchronously; adapters also accept change-only sources. */
  subscribe(listener: (snapshot: TSnapshot) => void | Promise<void>, options?: SubscriptionOptions): () => void;
}

export interface SelectorStoreOptions<TSelected> {
  equals?: (previous: TSelected, current: TSelected) => boolean;
  /** Receives eager/later subscriber failures. Defaults to the source SDK store's issue channel, then console.error. */
  onError?: (error: unknown) => void | Promise<void>;
}

export function createSelectorStore<TSnapshot, TSelected>(
  source: ImmediateStore<TSnapshot>,
  selector: (snapshot: TSnapshot) => TSelected,
  options?: SelectorStoreOptions<TSelected>
): ImmediateStore<TSelected>;

/**
 * Memoize selector calls by first-argument object identity and Object.is option arguments.
 * The object key is held weakly and up to 16 option variants are retained per identity.
 * The caller owns invalidation: inputs and returned values must be treated as immutable.
 */
export function createMemoizedSelector<TArguments extends readonly unknown[], TResult>(
  selector: (...args: TArguments) => TResult
): (...args: TArguments) => TResult;

export interface Observer<TValue> {
  next?(value: TValue): void | Promise<void>;
  error?(error: unknown): void;
  complete?(): void;
}
export interface Unsubscribable { unsubscribe(): void }
export interface Subscribable<TValue> {
  subscribe(observer: Observer<TValue> | ((value: TValue) => void | Promise<void>)): Unsubscribable;
}
/** Adapt an immediate store to the dependency-free TC39/RxJS observer contract. */
export function createSubscribable<TValue>(source: ImmediateStore<TValue>): Subscribable<TValue>;
