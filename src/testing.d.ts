import type { ConnectOptions, ConnectionStatus, JsonObject, MatchState, Scope } from './index.js';

export interface TransportContext {
  clientId: string;
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
  open(context: TransportContext): Promise<void>;
  resync?(): void;
  close?(): void | Promise<void>;
}

export interface TestingConnectOptions<TSettings = JsonObject> extends ConnectOptions<TSettings> {
  transport: Transport;
}

export function createDemoTransport<TSettings = JsonObject>(options?: {
  interval?: number;
  state?: MatchState<TSettings>;
}): Transport;
