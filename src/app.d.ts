import type {
  ConnectOptions,
  DeepReadonly,
  HostLifecycleSnapshot,
  ClientLifecycleSnapshot,
  Scope,
  MatchState,
  SubscriptionOptions,
  StartupOptions,
  W3BoosterClient
} from './index.js';
import type { DeepPartial } from './settings.js';

export interface ApplicationDefinition<
  TSettings extends object,
  TScopes extends readonly Scope[] = readonly Scope[]
> {
  readonly clientId: string;
  readonly revision: string;
  readonly scopes: TScopes;
  readonly settingsDefaults: DeepReadonly<TSettings>;
}

export type ApplicationConnectOptions<
  TSettings extends object,
  TScopes extends readonly Scope[]
> = Omit<ConnectOptions<DeepPartial<TSettings>>, 'clientId' | 'scopes'> & {
  readonly scopes?: readonly TScopes[number][] | 'configured';
};

export interface DefinedApplication<
  TSettings extends object,
  TScopes extends readonly Scope[]
> extends ApplicationDefinition<TSettings, TScopes> {
  connect(options?: ApplicationConnectOptions<TSettings, TScopes>): Promise<W3BoosterClient<DeepPartial<TSettings>>>;
  createClient(options?: ApplicationConnectOptions<TSettings, TScopes>): W3BoosterClient<DeepPartial<TSettings>>;
  start(
    options?: ApplicationConnectOptions<TSettings, TScopes>,
    startup?: StartupOptions
  ): Promise<W3BoosterClient<DeepPartial<TSettings>>>;
  createRuntime(options?: ApplicationConnectOptions<TSettings, TScopes>): ApplicationRuntime<TSettings>;
  resolveSettings(settings?: DeepPartial<TSettings>): DeepReadonly<TSettings>;
  settingsFor(
    state: Pick<MatchState<DeepPartial<TSettings>>, 'application'> | null | undefined
  ): DeepReadonly<TSettings>;
}

export interface ApplicationRuntimeSnapshot<TSettings extends object>
  extends ClientLifecycleSnapshot<DeepPartial<TSettings>> {
  readonly client: W3BoosterClient<DeepPartial<TSettings>>;
  readonly settings: DeepReadonly<TSettings>;
  readonly host: HostLifecycleSnapshot;
}

export interface ApplicationRuntimeStore<TSettings extends object> {
  get(): ApplicationRuntimeSnapshot<TSettings>;
  subscribe(
    listener: (snapshot: ApplicationRuntimeSnapshot<TSettings>) => void | Promise<void>,
    options?: SubscriptionOptions
  ): () => void;
}

export interface ApplicationRuntime<TSettings extends object> {
  readonly client: W3BoosterClient<DeepPartial<TSettings>>;
  readonly lifecycle: ApplicationRuntimeStore<TSettings>;
  start(options?: StartupOptions): Promise<W3BoosterClient<DeepPartial<TSettings>>>;
  stop(): Promise<void>;
}

export function defineApplication<
  TSettings extends object,
  const TScopes extends readonly Scope[]
>(definition: ApplicationDefinition<TSettings, TScopes>): DefinedApplication<TSettings, TScopes>;
