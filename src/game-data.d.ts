import type * as Contract from './game-data-contracts.js';
export type * from './game-data-contracts.js';
/** Loads only the exact revision advertised by the recorder; never substitutes the latest build. */
export declare const loadGameData: typeof Contract.loadGameData;
/** A standard-game estimate derived from this revision's ability configuration and observed game time. */
export declare const abilityCooldown: typeof Contract.abilityCooldown;
export declare const abilityCooldownsForState: typeof Contract.abilityCooldownsForState;
