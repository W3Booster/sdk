import type {
  ConnectOptions,
  DeepReadonly,
  JsonCompatible,
  HostLifecycleSnapshot,
  ClientLifecycleSnapshot,
  Scope,
  MatchState,
  SubscriptionOptions,
  StartupOptions,
  W3BoosterClient
} from './index.js';
type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [TKey in keyof T]?: DeepPartial<T[TKey]> }
    : T;

export interface ApplicationDefinition<
  TSettings extends object,
  TScopes extends readonly Scope[] = readonly Scope[]
> {
  readonly clientId: string;
  readonly revision: string;
  readonly scopes: TScopes;
  readonly settingsDefaults: DeepReadonly<JsonCompatible<TSettings>>;
}

export type ApplicationConnectOptions<
  TSettings extends object,
  TScopes extends readonly Scope[],
  TOverlayExtensions extends object = object
> = Omit<ConnectOptions<DeepPartial<TSettings>, TOverlayExtensions>, 'clientId' | 'scopes' | 'applicationRevision'> & {
  readonly scopes?: readonly TScopes[number][] | 'configured';
};

export interface DefinedApplication<
  TSettings extends object,
  TScopes extends readonly Scope[]
> extends ApplicationDefinition<TSettings, TScopes> {
  open<TOverlayExtensions extends object = object>(options?: ApplicationConnectOptions<TSettings, TScopes, TOverlayExtensions>): Promise<W3BoosterClient<DeepPartial<TSettings>, TOverlayExtensions>>;
  /** @deprecated Use `open()` for transport-only startup or `start()` for synchronized state. */
  connect<TOverlayExtensions extends object = object>(options?: ApplicationConnectOptions<TSettings, TScopes, TOverlayExtensions>): Promise<W3BoosterClient<DeepPartial<TSettings>, TOverlayExtensions>>;
  createClient<TOverlayExtensions extends object = object>(options?: ApplicationConnectOptions<TSettings, TScopes, TOverlayExtensions>): W3BoosterClient<DeepPartial<TSettings>, TOverlayExtensions>;
  start<TOverlayExtensions extends object = object>(
    options?: ApplicationConnectOptions<TSettings, TScopes, TOverlayExtensions>,
    startup?: StartupOptions
  ): Promise<W3BoosterClient<DeepPartial<TSettings>, TOverlayExtensions>>;
  createRuntime<TOverlayExtensions extends object = object>(options?: ApplicationConnectOptions<TSettings, TScopes, TOverlayExtensions>): ApplicationRuntime<TSettings, TOverlayExtensions>;
  resolveSettings(settings?: DeepPartial<TSettings>): DeepReadonly<TSettings>;
  settingsFor(
    state: Pick<MatchState<DeepPartial<TSettings>>, 'application'> | null | undefined
  ): DeepReadonly<TSettings>;
}

export interface ApplicationRuntimeSnapshot<TSettings extends object, TOverlayExtensions extends object = object>
  extends ClientLifecycleSnapshot<DeepPartial<TSettings>, TOverlayExtensions> {
  readonly client: W3BoosterClient<DeepPartial<TSettings>, TOverlayExtensions>;
  readonly settings: DeepReadonly<TSettings>;
  readonly host: HostLifecycleSnapshot;
}

export interface ApplicationRuntimeStore<TSettings extends object, TOverlayExtensions extends object = object> {
  get(): ApplicationRuntimeSnapshot<TSettings, TOverlayExtensions>;
  subscribe(
    listener: (snapshot: ApplicationRuntimeSnapshot<TSettings, TOverlayExtensions>) => void | Promise<void>,
    options?: SubscriptionOptions
  ): () => void;
}

export interface ApplicationRuntime<TSettings extends object, TOverlayExtensions extends object = object> {
  readonly client: W3BoosterClient<DeepPartial<TSettings>, TOverlayExtensions>;
  /** Aborts when this runtime stops; use it to scope client events and other runtime-owned work. */
  readonly signal: AbortSignal;
  readonly lifecycle: ApplicationRuntimeStore<TSettings, TOverlayExtensions>;
  start(options?: ApplicationRuntimeStartOptions): Promise<W3BoosterClient<DeepPartial<TSettings>, TOverlayExtensions>>;
  stop(): Promise<void>;
}

export interface ApplicationRuntimeStartOptions {
  /** Lifecycle milestone required before this caller resolves. Defaults to synchronized state. */
  until?: StartupOptions['until'];
  /** Maximum wait for this caller in milliseconds. Zero disables the timeout. */
  timeout?: number;
  /** Cancels only this caller's wait; the shared runtime and its client remain active. */
  signal?: AbortSignal;
}

export function defineApplication<
  TSettings extends object,
  const TScopes extends readonly Scope[]
>(definition: TSettings extends JsonCompatible<TSettings>
  ? ApplicationDefinition<TSettings, TScopes>
  : never): DefinedApplication<TSettings, TScopes>;
