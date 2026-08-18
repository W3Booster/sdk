export const SDK_VERSION: '0.2.0';
export const PROTOCOL_VERSION: '1.0';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly ['1.0'];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }
export type DeepReadonly<T> =
  T extends JsonPrimitive ? T :
  T extends readonly (infer TValue)[] ? readonly DeepReadonly<TValue>[] :
  T extends object ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> } :
  T;

export type Scope =
  | 'match:read'
  | 'players:read'
  | 'stats:read'
  | 'heroes:read'
  | 'upgrades:read'
  | 'resources:read'
  | 'controlgroups:read'
  | 'overlay:read';
export type KnownCapability = 'match' | 'players' | 'stats' | 'heroes' | 'upgrades' | 'resources' | 'controlgroups' | 'overlay';
export type Capability = KnownCapability | (string & {});
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
export type AppSurface = 'application' | 'streamOverlay' | 'ingameOverlay';
export type OverlaySurface = Exclude<AppSurface, 'application'>;
export type MatchStatus = 'starting' | 'running' | 'finished' | 'none';
export type Race = 'random' | 'human' | 'orc' | 'undead' | 'night-elf';
export type ConnectionErrorCode = 'UNAVAILABLE' | 'CONFIGURATION' | 'MISSING_BROWSER_API' | 'BROKER_TIMEOUT' | 'STATE_TIMEOUT' | 'HOST_UNAVAILABLE' | 'HOST_TIMEOUT';
export type W3BoosterErrorKind = 'abort' | 'permission' | 'connection' | 'protocol' | 'host-action' | 'unknown';
export interface W3BoosterErrorInfo {
  readonly kind: W3BoosterErrorKind;
  readonly code: string;
  readonly error: unknown;
  readonly status?: number;
  readonly authorizeUrl?: string;
}

export interface RetryOptions {
  /** Total connection attempts. Omit for unlimited retries. */
  maxAttempts?: number;
  /** Delay before the second attempt. Defaults to 250 milliseconds. */
  initialDelay?: number;
  /** Maximum delay between attempts. Defaults to 5 seconds. */
  maxDelay?: number;
}

export interface ReconnectOptions {
  /** Reconnect attempts after an established broker socket closes. Omit for unlimited retries. */
  maxAttempts?: number;
  /** Delay before the first reconnect attempt. Defaults to 500 milliseconds. */
  initialDelay?: number;
  /** Maximum delay between reconnect attempts. Defaults to 10 seconds. */
  maxDelay?: number;
}

export interface StartupOptions {
  /** Lifecycle milestone required before startup resolves. Defaults to synchronized state. */
  until?: 'connected' | 'ready' | 'synchronized';
  /** Maximum readiness wait in milliseconds. Zero disables the timeout. */
  timeout?: number;
  /** Cancels connection and readiness; standalone startup cancellation closes the client. */
  signal?: AbortSignal;
}

export interface SubscriptionOptions {
  /** Automatically unsubscribes when aborted. */
  signal?: AbortSignal;
}
export interface WatchOptions<T> extends SubscriptionOptions {
  /** Equality for suppressing unchanged selections. Defaults to Object.is. */
  equals?: (previous: T, current: T) => boolean;
}

export interface ConnectOptions<TSettings extends object = JsonObject> {
  clientId: string;
  /** Owns the client lifetime: aborting cancels connection attempts and disconnects an established client. */
  signal?: AbortSignal;
  /** Uses the scopes configured for the app by default. Pass an array only to request a smaller subset. */
  scopes?: readonly Scope[] | 'configured';
  demo?: boolean | {
    /** Update interval in milliseconds. Zero keeps the demo state static. Defaults to 1000. */
    interval?: number;
    state?: MatchState<TSettings>;
    settings?: TSettings;
    surface?: AppSurface;
  };
  /** Defaults to cloud. A platform-provided backend=local|cloud launch parameter takes precedence; applications do not parse it themselves. */
  backend?: 'auto' | 'local' | 'cloud';
  /** Explicit platform API origin. Prefer `backend` for standard local/cloud selection. */
  backendUrl?: string;
  /** Supplies the current bearer credential for each broker ticket request, including reconnects. */
  tokenProvider?: () => string | null | Promise<string | null>;
  localApi?: string;
  cloudApi?: string;
  /** Prefer the recorder's low-latency observer/replay feed when the platform exposes one. Defaults to true. */
  localRecorder?: boolean;
  /** Automatically report embedded application height to W3Booster. Defaults to true. */
  autoResize?: boolean;
  /** Retry transient initial connection failures. Unlimited policies require `signal`; an object configures the backoff. */
  retry?: boolean | RetryOptions;
  /** Retry transient failures after an established broker socket closes. Defaults to unlimited reconnects. */
  reconnect?: boolean | ReconnectOptions;
}

export interface ApplicationState<TSettings extends object = JsonObject> {
  readonly clientId: string;
  readonly settings: DeepReadonly<TSettings>;
  readonly surface?: AppSurface;
  readonly development?: boolean;
}
/** Runtime information produced by the recorder for overlay-capable apps. */
export interface OverlayRuntimeState {
  readonly chatbarOpen?: boolean;
  /** CSS scale multiplier normalized by W3Booster from 0.5 through 1.0. */
  readonly hudScale?: number;
  readonly matchScore?: MatchScore;
  readonly teamColors?: boolean;
}
export interface MatchScore {
  readonly wins: number;
  readonly losses: number;
}
export interface OverlayState {
  readonly runtime: OverlayRuntimeState;
}
export interface MatchState<TSettings extends object = JsonObject> {
  readonly capabilities: readonly Capability[];
  readonly match: Match;
  readonly players: readonly Player[];
  readonly overlay?: OverlayState;
  readonly application?: ApplicationState<TSettings>;
}
export interface Match {
  /** Stable match identity. Empty only while status is `none`. */
  readonly id: string;
  readonly status: MatchStatus;
  /** Elapsed in-game time in whole seconds, excluding paused time. */
  readonly gameTime: number;
  readonly mode: string;
  /** Human-readable, display-ready map name. Producers decode transport escaping before SDK delivery. */
  readonly map?: string;
  readonly realm?: string;
  readonly paused?: boolean;
  readonly isReplay?: boolean;
  readonly isReforged?: boolean;
  readonly isObserver?: boolean;
  readonly broadcasterPlayerId?: string;
  readonly realBroadcasterPlayerId?: string;
  /** ISO-8601 timestamp serialized by the API. */
  readonly startedAt?: string;
}
/** Warcraft III map coordinates. They are useful for relative map placement/order and are not screen pixels. */
export interface Point { readonly x: number; readonly y: number }
/** Player-facing resource and supply values; recorder-specific fixed-point units are already normalized. */
export interface Resources { readonly gold: number; readonly lumber: number; readonly supply: number; readonly supplyCap: number; readonly workerSupply?: number }
export interface PlayerStats {
  readonly wins: number;
  readonly losses: number;
  /** Win percentage from 0 through 100. */
  readonly winRate: number;
  readonly rank?: number;
  readonly league?: string | number;
  readonly level?: number;
}
export interface PlayerStatsCollection { readonly solo?: PlayerStats; readonly team?: PlayerStats; readonly team4?: PlayerStats; readonly ffa?: PlayerStats }
export interface MainAccount { readonly name: string; readonly country?: string; readonly mainRace?: Race }
export interface ControlGroup { readonly frontunit: string; readonly size: number }
export interface ValuePool { readonly current: number; readonly max: number }
export interface HeroAbility {
  /** Stable identity within its owning hero. */
  readonly id: string;
  /** Standard-game ability rawcode used for metadata and artwork lookup. */
  readonly name: string;
  readonly level: number;
  /** Activation time in milliseconds on the match game-time clock. */
  readonly lastActivation?: number;
}
export interface Hero {
  /** Standard-game hero rawcode used for metadata and artwork lookup. */
  readonly id: string;
  /** Human-readable hero name. */
  readonly name: string;
  readonly level: number;
  readonly experience?: number;
  readonly hitpoints?: ValuePool;
  readonly mana?: ValuePool;
  readonly abilities?: readonly HeroAbility[];
  readonly inventory?: readonly string[];
}
export interface CompletedUpgrade {
  /** Standard-game upgrade rawcode. */
  readonly name: string;
  readonly level: number;
  /** Unix timestamp in milliseconds when W3Booster observed the upgrade. */
  readonly gametime: number;
}
export interface ActiveUpgrade extends CompletedUpgrade {}
export interface ResearchingUpgrade extends ActiveUpgrade { readonly researchStart?: string; readonly researchFinish?: string }
export interface UpgradeState {
  readonly upgrades: readonly CompletedUpgrade[];
  readonly active: readonly ActiveUpgrade[];
  readonly researching: readonly ResearchingUpgrade[];
}
export interface Player {
  readonly id: string;
  readonly name?: string;
  readonly race?: Race;
  readonly team?: number;
  readonly colorId?: number;
  readonly startPosition?: Point;
  readonly isAI?: boolean;
  readonly mainAccount?: MainAccount;
  readonly controlgroups?: Readonly<Record<string, ControlGroup>>;
  readonly resources?: Resources;
  readonly heroes?: readonly Hero[];
  readonly upgrades?: UpgradeState;
  readonly stats?: PlayerStatsCollection;
}

export interface JsonPatchAdd { readonly op: 'add'; readonly path: string; readonly value: JsonValue }
export interface JsonPatchReplace { readonly op: 'replace'; readonly path: string; readonly value: JsonValue }
export interface JsonPatchRemove { readonly op: 'remove'; readonly path: string }
export type JsonPatchOperation = JsonPatchAdd | JsonPatchReplace | JsonPatchRemove;
export interface ProtocolEnvelope<TType extends string = string, TData = unknown> {
  version: string;
  sequence: number;
  type: TType;
  data: TData;
}
export type SnapshotMessage<TSettings extends object = JsonObject> = ProtocolEnvelope<'state.snapshot', MatchState<TSettings>>;
export type PatchMessage = ProtocolEnvelope<'state.patch', readonly JsonPatchOperation[]>;

export interface StateChangedEvent<TSettings extends object = JsonObject> { readonly state: MatchState<TSettings>; readonly previousState: MatchState<TSettings> | null; readonly initial: boolean }
export interface MatchChangedEvent<TSettings extends object = JsonObject> { readonly match: Match; readonly previousMatch: Match; readonly changedFields: readonly string[]; readonly state: MatchState<TSettings> }
export interface MatchLifecycleEvent<TSettings extends object = JsonObject> { readonly match: Match; readonly previousMatch?: Match; readonly nextMatch?: Match; readonly state: MatchState<TSettings> }
export interface PlayerEvent<TSettings extends object = JsonObject> { readonly playerId: string; readonly player: Player; readonly previousPlayer?: Player; readonly state: MatchState<TSettings> }
export interface PlayerChangedEvent<TSettings extends object = JsonObject> extends PlayerEvent<TSettings> { readonly changedFields: readonly string[] }
export interface HeroEvent<TSettings extends object = JsonObject> extends PlayerEvent<TSettings> { readonly heroId: string; readonly hero: Hero; readonly previousHero?: Hero }
export interface HeroChangedEvent<TSettings extends object = JsonObject> extends HeroEvent<TSettings> { readonly changedFields: readonly string[] }
export interface W3BoosterEventMap<TSettings extends object = JsonObject> {
  'state.ready': { readonly state: MatchState<TSettings> };
  'state.changed': StateChangedEvent<TSettings>;
  'match.started': MatchLifecycleEvent<TSettings>;
  'match.changed': MatchChangedEvent<TSettings>;
  'match.ended': MatchLifecycleEvent<TSettings>;
  'player.added': PlayerEvent<TSettings>;
  'player.changed': PlayerChangedEvent<TSettings>;
  'player.removed': PlayerEvent<TSettings>;
  'player.resources.changed': PlayerEvent<TSettings> & { readonly resources?: Resources; readonly previousResources?: Resources };
  'player.stats.changed': PlayerEvent<TSettings> & { readonly stats?: PlayerStatsCollection; readonly previousStats?: PlayerStatsCollection };
  'player.upgrades.changed': PlayerEvent<TSettings> & { readonly upgrades?: UpgradeState; readonly previousUpgrades?: UpgradeState };
  'hero.added': HeroEvent<TSettings>;
  'hero.changed': HeroChangedEvent<TSettings>;
  'hero.removed': HeroEvent<TSettings>;
  'hero.inventory.changed': HeroEvent<TSettings> & { readonly inventory: readonly string[]; readonly previousInventory: readonly string[] };
  'hero.abilities.changed': HeroEvent<TSettings> & { readonly abilities: readonly HeroAbility[]; readonly previousAbilities: readonly HeroAbility[] };
  'application.settings.changed': { readonly settings: DeepReadonly<TSettings> | undefined; readonly previousSettings: DeepReadonly<TSettings> | undefined; readonly application?: ApplicationState<TSettings>; readonly state: MatchState<TSettings> };
  status: ConnectionStatus;
  error: unknown;
  issue: W3BoosterIssue;
  'stream.gap': { readonly expected: number; readonly received: number };
}
export type W3BoosterEvent<TSettings extends object = JsonObject> = {
  [TType in keyof W3BoosterEventMap<TSettings>]: {
    readonly type: TType;
    readonly data: W3BoosterEventMap<TSettings>[TType];
  }
}[keyof W3BoosterEventMap<TSettings>];

export interface ReadyOptions {
  timeout?: number;
  /** Cancels only this readiness wait. */
  signal?: AbortSignal;
}
export interface StateStore<TSettings extends object = JsonObject> {
  /** Current hydrated state, or null until the first snapshot after connecting. */
  get(): MatchState<TSettings> | null;
  /** True only when state belongs to the current connected transport generation. */
  readonly isSynchronized: boolean;
  player(playerId: string | number): Player | null;
  /** Runs immediately and after every later state update or reset. Null means no hydrated state is currently available. */
  subscribe(listener: (state: MatchState<TSettings> | null) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  /** Runs immediately for the first selected value, including unavailable state, then according to the configured equality function. */
  watch<T>(selector: (state: MatchState<TSettings> | null) => T, listener: (value: T, previousValue: T | undefined, state: MatchState<TSettings> | null) => void | Promise<void>, options?: WatchOptions<T>): () => void;
  /** Wait for the first state snapshot. The default timeout is 10 seconds; zero disables the timeout. */
  whenReady(options?: ReadyOptions): Promise<MatchState<TSettings>>;
  /** Wait for a complete snapshot belonging to the current transport generation. */
  whenSynchronized(options?: ReadyOptions): Promise<MatchState<TSettings>>;
}
export interface W3BoosterEventEmitter<TSettings extends object = JsonObject> {
  on<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  on(type: '*', listener: (event: W3BoosterEvent<TSettings>) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  onUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  once<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  onceUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  off<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): void;
  off(type: string, listener: (data: unknown) => void): void;
}
export interface Diagnostics {
  readonly sdkVersion: string;
  readonly protocolVersion: string | null;
  readonly transport: string | null;
  readonly localTransport: 'recorder-local' | null;
}
export interface ClientLifecycleSnapshot<TSettings extends object = JsonObject> {
  readonly status: ConnectionStatus;
  readonly state: MatchState<TSettings> | null;
  readonly isSynchronized: boolean;
  /** The current connection or state-synchronization error. Non-fatal recorder and listener issues stay on the issue event. */
  readonly error: unknown | null;
}
export type W3BoosterIssueSource = 'connection' | 'protocol' | 'recorder' | 'listener';
export type W3BoosterIssueSeverity = 'warning' | 'error';
export interface W3BoosterIssue {
  readonly source: W3BoosterIssueSource;
  readonly severity: W3BoosterIssueSeverity;
  readonly recoverable: boolean;
  readonly error: unknown;
}
export interface ClientLifecycleStore<TSettings extends object = JsonObject> {
  /** Atomically read connection, state freshness, and the most recent SDK error. */
  get(): ClientLifecycleSnapshot<TSettings>;
  /** Runs immediately and whenever any lifecycle field changes. */
  subscribe(
    listener: (snapshot: ClientLifecycleSnapshot<TSettings>) => void | Promise<void>,
    options?: SubscriptionOptions
  ): () => void;
}
export class W3BoosterClient<TSettings extends object = JsonObject> {
  /** Complete platform state. */
  readonly state: StateStore<TSettings>;
  readonly events: W3BoosterEventEmitter<TSettings>;
  readonly host: W3BoosterHost<TSettings>;
  readonly diagnostics: Diagnostics;
  readonly lifecycle: ClientLifecycleStore<TSettings>;
  readonly status: ConnectionStatus;
  private constructor(options: ConnectOptions<TSettings> | string);
  /** Open a transport. The optional signal cancels this connection attempt. */
  connect(options?: { readonly signal?: AbortSignal }): Promise<this>;
  /** Connect and optionally wait for hydrated or synchronized state. The default synchronized wait has no timeout. */
  start(options?: StartupOptions): Promise<this>;
  whenReady(options?: ReadyOptions): Promise<MatchState<TSettings>>;
  whenSynchronized(options?: ReadyOptions): Promise<MatchState<TSettings>>;
  /** Runs immediately with the current status and after every later transition. */
  subscribeStatus(listener: (status: ConnectionStatus) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  on<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  on(type: '*', listener: (event: W3BoosterEvent<TSettings>) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  onUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  once<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  onceUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
  off<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): void;
  off(type: string, listener: (data: unknown) => void): void;
  /** Close transports and clear hydrated state. Event subscriptions remain usable if this client reconnects. */
  disconnect(): Promise<void>;
}
export interface OpenWindowOptions {
  readonly path?: string;
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
}
export type MatchScoreSide = 'wins' | 'losses';
export type HostCapability = 'window:open' | 'window:close' | 'match-score:write' | 'settings:write' | 'resize:report' | 'command';
export type HostCapabilityStatus = 'unavailable' | 'pending' | 'known' | 'legacy';
export interface HostLifecycleSnapshot {
  readonly available: boolean;
  readonly capabilities: readonly HostCapability[];
  readonly capabilityStatus: HostCapabilityStatus;
}
export interface HostLifecycleStore {
  get(): HostLifecycleSnapshot;
  /** Runs immediately and whenever host availability or capability discovery changes. */
  subscribe(listener: (snapshot: HostLifecycleSnapshot) => void | Promise<void>, options?: SubscriptionOptions): () => void;
}
type StringKey<T> = Extract<keyof T, string>;
export type SettingsPath<TSettings> = string extends keyof TSettings ? string : {
  [TKey in StringKey<TSettings>]: NonNullable<TSettings[TKey]> extends readonly unknown[]
    ? TKey
    : NonNullable<TSettings[TKey]> extends object
      ? TKey | `${TKey}.${SettingsPath<NonNullable<TSettings[TKey]>>}`
      : TKey
}[StringKey<TSettings>];
export type SettingsPathValue<TSettings, TPath extends string> = string extends keyof TSettings
  ? Exclude<TSettings[string & keyof TSettings], undefined>
  : TPath extends `${infer TKey}.${infer TRest}`
    ? TKey extends keyof TSettings
      ? SettingsPathValue<NonNullable<TSettings[TKey]>, TRest>
      : never
    : TPath extends keyof TSettings
      ? Exclude<TSettings[TPath], undefined>
      : never;
export interface W3BoosterHost<TSettings extends object = JsonObject> {
  readonly lifecycle: HostLifecycleStore;
  readonly available: boolean;
  readonly capabilities: readonly HostCapability[];
  /** Discovery state. `legacy` means the host accepts actions but cannot advertise them. */
  readonly capabilityStatus: HostCapabilityStatus;
  supports(capability: HostCapability): boolean;
  /** Whether an action should currently be offered, including compatibility with legacy hosts. */
  can(capability: HostCapability): boolean;
  /** Ask the authenticated host to advertise supported actions. Older hosts transition to `legacy`. */
  refreshCapabilities(): Promise<readonly HostCapability[]>;
  subscribeCapabilities(
    listener: (capabilities: readonly HostCapability[], status: HostCapabilityStatus) => void | Promise<void>,
    options?: SubscriptionOptions
  ): () => void;
  openWindow(options?: OpenWindowOptions): Promise<unknown>;
  closeWindow(): Promise<unknown>;
  changeMatchScore(side: MatchScoreSide, delta: 1 | -1): Promise<unknown>;
  resetMatchScore(): Promise<unknown>;
  command(command: string, payload?: unknown): Promise<unknown>;
  /** Persist a setting and resolve only after the host confirms the saved settings. */
  setSetting<TPath extends SettingsPath<TSettings>>(path: TPath, value: SettingsPathValue<TSettings, TPath>): Promise<DeepReadonly<TSettings>>;
  startAutoResize(): void;
  stopAutoResize(): void;
}
export class PermissionRequiredError extends Error {
  constructor(message: string, authorizeUrl?: string);
  readonly code: 'PERMISSION_REQUIRED';
  readonly authorizeUrl?: string;
}
export class ConnectionError extends Error {
  constructor(message: string, causes?: unknown[], code?: ConnectionErrorCode, status?: number);
  readonly causes: readonly unknown[];
  readonly code: ConnectionErrorCode;
  readonly status?: number;
}
export class ProtocolError extends Error {
  constructor(code: string, message: string, details?: unknown);
  readonly code: string;
  readonly details?: unknown;
}
export class HostActionError extends Error {
  constructor(message: string, code?: string);
  readonly code: string;
}
export function connect<TSettings extends object = JsonObject>(options: ConnectOptions<TSettings> | string): Promise<W3BoosterClient<TSettings>>;
export function createClient<TSettings extends object = JsonObject>(options: ConnectOptions<TSettings> | string): W3BoosterClient<TSettings>;
export function isAbortError(error: unknown): boolean;
export function isW3BoosterError(error: unknown): error is PermissionRequiredError | ConnectionError | ProtocolError | HostActionError;
export function classifyW3BoosterError(error: unknown): W3BoosterErrorInfo;
export function canUseHostCapability(snapshot: HostLifecycleSnapshot, capability: HostCapability): boolean;
