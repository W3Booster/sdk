export interface OverlayInputOptions {
  /** Optional expected compositor origin. Messages must always come from the parent frame. */
  readonly parentOrigin?: string;
  readonly signal?: AbortSignal;
}
export interface OverlayInputRegistration {
  /** Re-scan marked elements immediately. Normally automatic. */
  refresh(): void;
  /** Remove regions, cancel owned gestures and stop all observers/listeners. */
  close(): void;
}
/** Enable declarative .w3-interactive regions in an embedded in-game overlay.
 * Initialize once before installing application pointer handlers. In standalone
 * pages and OBS this remains inactive until an in-game compositor handshake.
 */
export function initializeOverlayInput(options?: OverlayInputOptions): OverlayInputRegistration;
