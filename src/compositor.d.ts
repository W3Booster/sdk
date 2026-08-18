import type { OverlaySurface } from './index.js';

export interface BrowserSourceCredentials {
  channel: string;
  secret: string;
  surface?: OverlaySurface;
}

export interface OverlayCompositionOptions {
  /** Cancels one-shot loading and owns the returned watcher lifetime. */
  signal?: AbortSignal;
  /** Defaults to cloud. Platform-provided backend=local|cloud takes precedence. */
  backend?: 'auto' | 'local' | 'cloud';
  /** Explicit platform API origin. Prefer `backend` for standard local/cloud selection. */
  backendUrl?: string;
  localApi?: string;
  cloudApi?: string;
  /** Supplies the current compositor credential for each authorization attempt. */
  tokenProvider?: () => string | null | Promise<string | null>;
  /** Stable credentials from the user's W3Booster browser-source URL. */
  browserSource?: BrowserSourceCredentials;
  surface?: OverlaySurface;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface OverlayCompositionApp {
  appId: string;
  clientId: string;
  name: string;
  url: string;
  development?: boolean;
}

export interface OverlayCompositionWatcher { close(): void }

export function getOverlayComposition(options?: OverlayCompositionOptions): Promise<OverlayCompositionApp[]>;
export function watchOverlayComposition(
  options: OverlayCompositionOptions,
  listener: (event: { type: 'composition.ready' | 'composition.changed'; surface?: OverlaySurface }) => void | Promise<void>
): Promise<OverlayCompositionWatcher>;
