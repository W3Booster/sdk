import type { AppSurface, ConnectOptions, ConnectionStatus, JsonObject, JsonObjectInput, MatchState, OverlayExtensionsInput, Scope } from './index.js';

export interface TransportContext {
  clientId: string;
  applicationRevision?: string;
  /** Aborted when the pending connection is cancelled or explicitly disconnected. */
  signal: AbortSignal;
  /** Empty means all scopes configured for this app. */
  scopes: Scope[];
  protocolVersions: readonly string[];
  onMessage: (message: unknown) => void;
  onStatus: (status: ConnectionStatus) => void;
  onError: (error: unknown) => void;
}

export interface Transport {
  name: string;
  open(context: TransportContext): void | Promise<void>;
  resync?(): void;
  close?(): void | Promise<void>;
}

export interface TestingConnectOptions<TSettings extends object = JsonObject, TOverlayExtensions extends object = object>
  extends ConnectOptions<TSettings, TOverlayExtensions> {
  transport: Transport;
}

type DemoTransportOptions<TSettings extends object, TOverlayExtensions extends object> = {
  /** Update interval in milliseconds. Zero keeps the demo state static. Defaults to 1000. */
  interval?: number;
  state?: MatchState<TSettings, TOverlayExtensions>;
  overlayExtensions?: TOverlayExtensions;
  settings?: TSettings;
  surface?: AppSurface;
};

type DemoStateOptions<TSettings extends object, TOverlayExtensions extends object> = {
  clientId?: string;
  settings?: TSettings;
  surface?: AppSurface;
  overlayExtensions?: TOverlayExtensions;
};

type DemoArguments<TSettings extends object, TOverlayExtensions extends object, TOptions> =
  TSettings extends JsonObjectInput<TSettings>
    ? TOverlayExtensions extends OverlayExtensionsInput<TOverlayExtensions>
      ? [options?: TOptions]
      : [options: never]
    : [options: never];

export function createDemoTransport<TSettings extends object = JsonObject, TOverlayExtensions extends object = object>(
  ...args: DemoArguments<TSettings, TOverlayExtensions, DemoTransportOptions<TSettings, TOverlayExtensions>>
): Transport;

/** Create a complete deterministic state for application unit tests and demos. */
export function createDemoState<TSettings extends object = JsonObject, TOverlayExtensions extends object = object>(
  ...args: DemoArguments<TSettings, TOverlayExtensions, DemoStateOptions<TSettings, TOverlayExtensions>>
): MatchState<TSettings, TOverlayExtensions>;
