import type * as Contract from './analytics-contracts.js';
export type * from './analytics-contracts.js';
/** Optional framework-neutral current-match history. No timers, transport or persistence. */
export declare const createMatchHistory: typeof Contract.createMatchHistory;
/** Optional bounded unit contribution history; costs and application-specific grouping remain app-side. */
export declare const createUnitHistory: typeof Contract.createUnitHistory;
