import type * as Contract from './store-contracts.js';
export type * from './store-contracts.js';
export declare const createSelectorStore: typeof Contract.createSelectorStore;
/**
 * Memoize selector calls by first-argument object identity and Object.is option arguments.
 * The object key is held weakly and up to 16 option variants are retained per identity.
 * The caller owns invalidation: inputs and returned values must be treated as immutable.
 */
export declare const createMemoizedSelector: typeof Contract.createMemoizedSelector;
/** Adapt an immediate store to the dependency-free TC39/RxJS observer contract. */
export declare const createSubscribable: typeof Contract.createSubscribable;
