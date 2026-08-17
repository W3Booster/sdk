import type { OverlaySurface } from './index.js';

export interface BrowserSourceCredentials {
  channel: string;
  secret: string;
  surface?: OverlaySurface;
}

export interface OverlayCompositionOptions {
  api?: string;
  /** Defaults to cloud. Platform-provided backend=local|cloud takes precedence. */
  backend?: 'auto' | 'local' | 'cloud' | string;
  localApi?: string;
  cloudApi?: string;
  tokenProvider?: () => string | null | Promise<string | null>;
  /** Stable credentials from the user's W3Booster browser-source URL. */
  browserSource?: BrowserSourceCredentials;
  surface?: OverlaySurface;
  onError?: (error: unknown) => void;
}

export interface OverlayCompositionApp {
  appId: string;
  clientId: string;
  name: string;
  url: string;
}

export interface OverlayCompositionWatcher { close(): void }

export function getOverlayComposition(options?: OverlayCompositionOptions): Promise<OverlayCompositionApp[]>;
export function watchOverlayComposition(
  options: OverlayCompositionOptions,
  listener: (event: { type: 'composition.ready' | 'composition.changed'; surface?: OverlaySurface }) => void
): Promise<OverlayCompositionWatcher>;
