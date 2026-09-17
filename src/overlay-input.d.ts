import type * as Contract from './overlay-input-contracts.js';
export type * from './overlay-input-contracts.js';
/** Enable declarative .w3-interactive regions in an embedded in-game overlay.
 * Initialize once before installing application pointer handlers. In standalone
 * pages and OBS this remains inactive until an in-game compositor handshake.
 */
export declare const initializeOverlayInput: typeof Contract.initializeOverlayInput;
