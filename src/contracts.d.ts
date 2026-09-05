export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonCompatible<T> = T extends JsonPrimitive ? T : T extends (...args: never[]) => unknown ? never : T extends readonly (infer TValue)[] ? readonly JsonCompatible<TValue>[] : T extends object ? {
    [TKey in keyof T]: JsonCompatible<T[TKey]>;
} : never;
/** Call-site constraint for JSON-compatible root records. Nested arrays remain valid JSON values. */
export type JsonObjectInput<T extends object> = T extends readonly unknown[] ? never : T extends JsonCompatible<T> ? T : never;
export type DeepReadonly<T> = T extends JsonPrimitive ? T : T extends readonly (infer TValue)[] ? readonly DeepReadonly<TValue>[] : T extends object ? {
    readonly [TKey in keyof T]: DeepReadonly<T[TKey]>;
} : T;
export type Scope = 'match:read' | 'players:read' | 'stats:read' | 'heroes:read' | 'upgrades:read' | 'resources:read' | 'controlgroups:read'
/** @deprecated Game context is always delivered; retained for existing app bindings. */
 | 'overlay:read';
export type KnownCapability = 'match' | 'players' | 'stats' | 'heroes' | 'upgrades' | 'resources' | 'controlgroups' | 'overlay';
export type Capability = KnownCapability | (string & {});
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
export type AppSurface = 'application' | 'streamOverlay' | 'ingameOverlay';
export type OverlaySurface = Exclude<AppSurface, 'application'>;
export type MatchStatus = 'starting' | 'running' | 'finished' | 'none';
export type Race = 'random' | 'human' | 'orc' | 'undead' | 'night-elf';
export type ConnectionErrorCode = 'UNAVAILABLE' | 'CONFIGURATION' | 'APPLICATION_DEFINITION_MISMATCH' | 'MISSING_BROWSER_API' | 'BROKER_TIMEOUT' | 'STARTUP_TIMEOUT' | 'STATE_TIMEOUT' | 'HOST_UNAVAILABLE' | 'HOST_TIMEOUT';
export type W3BoosterErrorKind = 'abort' | 'permission' | 'connection' | 'protocol' | 'host-action' | 'unknown';
export interface AbortError {
    readonly name: 'AbortError';
    readonly message?: string;
}
export type W3BoosterErrorInfo = {
    readonly kind: 'abort';
    readonly code: 'ABORTED';
    readonly error: AbortError;
} | {
    readonly kind: 'permission';
    readonly code: 'PERMISSION_REQUIRED';
    readonly error: PermissionRequiredError;
    readonly authorizeUrl?: string;
} | {
    readonly kind: 'connection';
    readonly code: ConnectionErrorCode;
    readonly error: ConnectionError;
    readonly status?: number;
} | {
    readonly kind: 'protocol';
    readonly code: string;
    readonly error: ProtocolError;
} | {
    readonly kind: 'host-action';
    readonly code: string;
    readonly error: HostActionError;
} | {
    readonly kind: 'unknown';
    readonly code: 'UNKNOWN';
    readonly error: unknown;
};
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
export interface MatchLifecycleSubscriptionOptions extends SubscriptionOptions {
    /** Also report the current finished match as an initial ended observation. Defaults to false. */
    includeCurrentFinished?: boolean;
}
export interface WatchOptions<T> extends SubscriptionOptions {
    /** Equality for suppressing unchanged selections. Defaults to Object.is. */
    equals?: (previous: T, current: T) => boolean;
}
export interface ConnectOptions<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    clientId: string;
    /** Generated application-definition revision. `defineApplication()` supplies this automatically. */
    applicationRevision?: string;
    /** Owns the client lifetime: aborting cancels connection attempts and disconnects an established client. */
    signal?: AbortSignal;
    /** Uses the scopes configured for the app by default. Pass an array only to request a smaller subset. */
    scopes?: readonly Scope[] | 'configured';
    demo?: boolean | {
        /** Update interval in milliseconds. Zero keeps the demo state static. Defaults to 1000. */
        interval?: number;
        state?: MatchState<TSettings, TOverlayExtensions>;
        settings?: JsonCompatible<TSettings>;
        surface?: AppSurface;
    };
    /** Defaults to cloud. A platform-provided backend=local|cloud launch parameter takes precedence; applications do not parse it themselves. */
    backend?: 'auto' | 'local' | 'cloud';
    /** Explicit platform API origin. Prefer `backend` for standard local/cloud selection. */
    backendUrl?: string;
    /** Supplies the current bearer credential for each broker ticket request, including reconnects. */
    tokenProvider?: () => string | null | Promise<string | null>;
    /** @deprecated Use `backend` and `backendUrl`; retained for SDK 1 configuration compatibility. */
    localApi?: string;
    /** @deprecated Use `backend` and `backendUrl`; retained for SDK 1 configuration compatibility. */
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
    readonly settings: DeepReadonly<JsonCompatible<TSettings>>;
    /** Read-only runtime data belonging to this application, separate from saved settings. */
    readonly data?: DeepReadonly<JsonObject>;
    readonly surface?: AppSurface;
    readonly development?: boolean;
}
/** Shared game context, delivered without a scope to every authorized application. */
export interface GameContext {
    /** CSS scale multiplier from 0.5 to 1.0. Defaults to 1 when no measurement is available. */
    readonly hudScale: number;
    readonly chatbarOpen?: boolean;
    readonly teamColors?: boolean;
}
/** @deprecated Use gameContext. This branch remains a compatibility alias. */
export interface OverlayRuntimeState {
    readonly chatbarOpen?: boolean;
    /** CSS scale multiplier normalized by W3Booster from 0.5 through 1.0. */
    readonly hudScale?: number;
    /** @deprecated App-owned scores belong in application.data; this legacy alias is app-restricted. */
    readonly matchScore?: MatchScore;
    readonly teamColors?: boolean;
}
export interface MatchScore {
    readonly wins: number;
    readonly losses: number;
}
export type OverlayExtensionReservedKey = 'runtime' | 'misc' | 'settings';
/** Call-site constraint for JSON-compatible overlay extensions that cannot shadow SDK-owned branches. */
export type OverlayExtensionsInput<TOverlayExtensions extends object> = TOverlayExtensions extends JsonObjectInput<TOverlayExtensions> ? Extract<OverlayExtensionReservedKey, keyof TOverlayExtensions> extends never ? TOverlayExtensions : never : never;
/** Extension branches are deeply immutable; normalization-owned overlay keys cannot be extensions. */
export type OverlayState<TOverlayExtensions extends object = object> = TOverlayExtensions extends OverlayExtensionsInput<TOverlayExtensions> ? DeepReadonly<TOverlayExtensions> & {
    readonly runtime: OverlayRuntimeState;
} : never;
export interface MatchState<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    readonly capabilities: readonly Capability[];
    readonly match: Match;
    readonly players: readonly Player[];
    /** Always supplied by the current SDK; optional here for legacy wire snapshots and fixtures. */
    readonly gameContext?: GameContext;
    readonly overlay?: OverlayState<TOverlayExtensions>;
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
    /** Authoritative ISO-8601 completion time when supplied by the platform. */
    readonly endedAt?: string;
}
/** Warcraft III map coordinates. They are useful for relative map placement/order and are not screen pixels. */
export interface Point {
    readonly x: number;
    readonly y: number;
}
/** Player-facing resource and supply values; recorder-specific fixed-point units are already normalized. */
export interface Resources {
    readonly gold: number;
    readonly lumber: number;
    readonly supply: number;
    readonly supplyCap: number;
    readonly workerSupply?: number;
}
export interface PlayerStats {
    readonly wins: number;
    readonly losses: number;
    /** Win percentage from 0 through 100. */
    readonly winRate: number;
    readonly rank?: number;
    readonly league?: string | number;
    readonly level?: number;
}
export interface PlayerStatsCollection {
    readonly solo?: PlayerStats;
    readonly team?: PlayerStats;
    readonly team4?: PlayerStats;
    readonly ffa?: PlayerStats;
}
export interface MainAccount {
    readonly name: string;
    readonly country?: string;
    readonly mainRace?: Race;
}
export interface ControlGroup {
    readonly frontunit: string;
    readonly size: number;
}
export interface ValuePool {
    readonly current: number;
    readonly max: number;
}
export interface HeroAbility {
    /** Stable identity within its owning hero. */
    readonly id: string;
    /** Standard-game ability rawcode used for metadata and artwork lookup. */
    readonly name: string;
    readonly level: number;
    /** Positive millisecond timestamp on the match game-time clock; absence means never activated. */
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
export interface ActiveUpgrade extends CompletedUpgrade {
}
export interface ResearchingUpgrade extends ActiveUpgrade {
    readonly researchStart?: string;
    readonly researchFinish?: string;
}
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
export interface JsonPatchAdd {
    readonly op: 'add';
    readonly path: string;
    readonly value: JsonValue;
}
export interface JsonPatchReplace {
    readonly op: 'replace';
    readonly path: string;
    readonly value: JsonValue;
}
export interface JsonPatchRemove {
    readonly op: 'remove';
    readonly path: string;
}
export type JsonPatchOperation = JsonPatchAdd | JsonPatchReplace | JsonPatchRemove;
export interface ProtocolEnvelope<TType extends string = string, TData = unknown> {
    version: string;
    sequence: number;
    type: TType;
    data: TData;
}
export type SnapshotMessage<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> = ProtocolEnvelope<'state.snapshot', MatchState<TSettings, TOverlayExtensions>>;
export type PatchMessage = ProtocolEnvelope<'state.patch', readonly JsonPatchOperation[]>;
export interface StateChangedEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    readonly state: MatchState<TSettings, TOverlayExtensions>;
    readonly previousState: MatchState<TSettings, TOverlayExtensions> | null;
    readonly initial: boolean;
}
export interface MatchChangedEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    readonly match: Match;
    readonly previousMatch: Match;
    readonly changedFields: readonly string[];
    readonly state: MatchState<TSettings, TOverlayExtensions>;
}
export interface MatchLifecycleEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    /** Started match, or the completed snapshot for a same-ID ended transition. */
    readonly match: Match;
    readonly previousMatch?: Match;
    readonly nextMatch?: Match;
    readonly state: MatchState<TSettings, TOverlayExtensions>;
    /** Client observation time; this is not an authoritative match timestamp. */
    readonly observedAt: string;
}
export interface MatchLifecycleObservationEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> extends MatchLifecycleEvent<TSettings, TOverlayExtensions> {
    readonly phase: 'started' | 'ended'; /** True when subscription observes the current match during hydration. */
    readonly initial: boolean;
}
export interface PlayerEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    readonly playerId: string;
    readonly player: Player;
    readonly previousPlayer?: Player;
    readonly state: MatchState<TSettings, TOverlayExtensions>;
}
export interface PlayerChangedEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> extends PlayerEvent<TSettings, TOverlayExtensions> {
    readonly changedFields: readonly string[];
}
export interface HeroEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> extends PlayerEvent<TSettings, TOverlayExtensions> {
    readonly heroId: string;
    readonly hero: Hero;
    readonly previousHero?: Hero;
}
export interface HeroChangedEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> extends HeroEvent<TSettings, TOverlayExtensions> {
    readonly changedFields: readonly string[];
}
export interface W3BoosterEventMap<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    'state.ready': {
        readonly state: MatchState<TSettings, TOverlayExtensions>;
    };
    'state.changed': StateChangedEvent<TSettings, TOverlayExtensions>;
    'match.started': MatchLifecycleEvent<TSettings, TOverlayExtensions>;
    'match.changed': MatchChangedEvent<TSettings, TOverlayExtensions>;
    'match.ended': MatchLifecycleEvent<TSettings, TOverlayExtensions>;
    'player.added': PlayerEvent<TSettings, TOverlayExtensions>;
    'player.changed': PlayerChangedEvent<TSettings, TOverlayExtensions>;
    'player.removed': PlayerEvent<TSettings, TOverlayExtensions>;
    'player.resources.changed': PlayerEvent<TSettings, TOverlayExtensions> & {
        readonly resources?: Resources;
        readonly previousResources?: Resources;
    };
    'player.stats.changed': PlayerEvent<TSettings, TOverlayExtensions> & {
        readonly stats?: PlayerStatsCollection;
        readonly previousStats?: PlayerStatsCollection;
    };
    'player.upgrades.changed': PlayerEvent<TSettings, TOverlayExtensions> & {
        readonly upgrades?: UpgradeState;
        readonly previousUpgrades?: UpgradeState;
    };
    'hero.added': HeroEvent<TSettings, TOverlayExtensions>;
    'hero.changed': HeroChangedEvent<TSettings, TOverlayExtensions>;
    'hero.removed': HeroEvent<TSettings, TOverlayExtensions>;
    'hero.inventory.changed': HeroEvent<TSettings, TOverlayExtensions> & {
        readonly inventory: readonly string[];
        readonly previousInventory: readonly string[];
    };
    'hero.abilities.changed': HeroEvent<TSettings, TOverlayExtensions> & {
        readonly abilities: readonly HeroAbility[];
        readonly previousAbilities: readonly HeroAbility[];
    };
    'application.settings.changed': {
        readonly settings: DeepReadonly<TSettings> | undefined;
        readonly previousSettings: DeepReadonly<TSettings> | undefined;
        readonly application?: ApplicationState<TSettings>;
        readonly state: MatchState<TSettings, TOverlayExtensions>;
    };
    status: ConnectionStatus;
    /** @deprecated Use `issue` for structured diagnostics and `client.lifecycle.error` for connection/synchronization failures. */
    error: unknown;
    issue: W3BoosterIssue;
    'stream.gap': {
        readonly expected: number;
        readonly received: number;
    };
}
export type W3BoosterEvent<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> = {
    [TType in keyof W3BoosterEventMap<TSettings, TOverlayExtensions>]: {
        readonly type: TType;
        readonly data: W3BoosterEventMap<TSettings, TOverlayExtensions>[TType];
    };
}[keyof W3BoosterEventMap<TSettings, TOverlayExtensions>];
export interface ReadyOptions {
    timeout?: number;
    /** Cancels only this readiness wait. */
    signal?: AbortSignal;
}
export interface StateStore<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    /** Current hydrated state, or null until the first snapshot after connecting. */
    get(): MatchState<TSettings, TOverlayExtensions> | null;
    /** True only when state belongs to the current connected transport generation. */
    readonly isSynchronized: boolean;
    player(playerId: string | number): Player | null;
    /** Runs immediately and after every later state update, reset, or synchronization-freshness change. The same state identity may be delivered when only freshness changes. Null means no hydrated state is currently available. */
    subscribe(listener: (state: MatchState<TSettings, TOverlayExtensions> | null) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    /** Runs immediately for the first selected value, including unavailable state, and reevaluates after state, reset, or synchronization-freshness changes. The listener runs according to the configured equality function. */
    watch<T>(selector: (state: MatchState<TSettings, TOverlayExtensions> | null) => T, listener: (value: T, previousValue: T | undefined, state: MatchState<TSettings, TOverlayExtensions> | null) => void | Promise<void>, options?: WatchOptions<T>): () => void;
    /** Wait for the first state snapshot. The default timeout is 10 seconds; zero disables the timeout. */
    whenReady(options?: ReadyOptions): Promise<MatchState<TSettings, TOverlayExtensions>>;
    /** Wait for a complete snapshot belonging to the current transport generation. */
    whenSynchronized(options?: ReadyOptions): Promise<MatchState<TSettings, TOverlayExtensions>>;
}
export interface W3BoosterEventEmitter<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    on<K extends keyof W3BoosterEventMap<TSettings, TOverlayExtensions>>(type: K, listener: (data: W3BoosterEventMap<TSettings, TOverlayExtensions>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    on(type: '*', listener: (event: W3BoosterEvent<TSettings, TOverlayExtensions>) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    onUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    once<K extends keyof W3BoosterEventMap<TSettings, TOverlayExtensions>>(type: K, listener: (data: W3BoosterEventMap<TSettings, TOverlayExtensions>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    once(type: '*', listener: (event: W3BoosterEvent<TSettings, TOverlayExtensions>) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    onceUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    off<K extends keyof W3BoosterEventMap<TSettings, TOverlayExtensions>>(type: K, listener: (data: W3BoosterEventMap<TSettings, TOverlayExtensions>[K]) => void): void;
    off(type: string, listener: (data: unknown) => void): void;
}
export interface Diagnostics {
    readonly sdkVersion: string;
    readonly protocolVersion: string | null;
    readonly transport: string | null;
    readonly localTransport: 'recorder-local' | null;
}
export interface ConnectionRetrySnapshot {
    /** The retry attempt that is waiting or currently in progress. The first connection attempt is 1. */
    readonly attempt: number;
    /** Configured total attempt limit, or null for an unlimited policy. */
    readonly maxAttempts: number | null;
    /** Milliseconds before this attempt starts, or null while the attempt is in progress. */
    readonly nextDelay: number | null;
    /** The transient failure that caused this retry. */
    readonly lastError: unknown;
}
export interface ClientLifecycleSnapshot<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    readonly status: ConnectionStatus;
    readonly state: MatchState<TSettings, TOverlayExtensions> | null;
    readonly isSynchronized: boolean;
    /** The current connection or state-synchronization error. Non-fatal recorder and listener issues stay on the issue event. */
    readonly error: unknown | null;
    /** Initial-connection retry detail. Status remains `connecting`; null when no initial retry is active. */
    readonly retry: ConnectionRetrySnapshot | null;
}
export type W3BoosterIssueSource = 'connection' | 'protocol' | 'recorder' | 'listener';
export type W3BoosterIssueSeverity = 'warning' | 'error';
export interface W3BoosterIssue {
    readonly source: W3BoosterIssueSource;
    readonly severity: W3BoosterIssueSeverity;
    readonly recoverable: boolean;
    readonly error: unknown;
}
export interface ClientLifecycleStore<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    /** Atomically read connection, state freshness, and the most recent SDK error. */
    get(): ClientLifecycleSnapshot<TSettings, TOverlayExtensions>;
    /** Runs immediately and whenever any lifecycle field changes. */
    subscribe(listener: (snapshot: ClientLifecycleSnapshot<TSettings, TOverlayExtensions>) => void | Promise<void>, options?: SubscriptionOptions): () => void;
}
export interface W3BoosterClient<TSettings extends object = JsonObject, TOverlayExtensions extends object = object> {
    /** Complete platform state. */
    readonly state: StateStore<TSettings, TOverlayExtensions>;
    readonly events: W3BoosterEventEmitter<TSettings, TOverlayExtensions>;
    readonly host: W3BoosterHost<TSettings>;
    readonly diagnostics: Diagnostics;
    readonly lifecycle: ClientLifecycleStore<TSettings, TOverlayExtensions>;
    readonly status: ConnectionStatus;
    /** Open a transport. The optional signal cancels this connection attempt. */
    open(options?: {
        readonly signal?: AbortSignal;
    }): Promise<this>;
    /** @deprecated Use `open()` for transport-only startup or `start()` when synchronized state is required. */
    connect(options?: {
        readonly signal?: AbortSignal;
    }): Promise<this>;
    /** Connect and optionally wait for hydrated or synchronized state. The default synchronized wait has no timeout. */
    start(options?: StartupOptions): Promise<this>;
    whenReady(options?: ReadyOptions): Promise<MatchState<TSettings, TOverlayExtensions>>;
    whenSynchronized(options?: ReadyOptions): Promise<MatchState<TSettings, TOverlayExtensions>>;
    /** Runs immediately with the current status and after every later transition. */
    subscribeStatus(listener: (status: ConnectionStatus) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    /** Reports an already-active match immediately, optionally the current finished match, then all later transitions. */
    subscribeMatchLifecycle(listener: (event: MatchLifecycleObservationEvent<TSettings, TOverlayExtensions>) => void | Promise<void>, options?: MatchLifecycleSubscriptionOptions): () => void;
    on<K extends keyof W3BoosterEventMap<TSettings, TOverlayExtensions>>(type: K, listener: (data: W3BoosterEventMap<TSettings, TOverlayExtensions>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    on(type: '*', listener: (event: W3BoosterEvent<TSettings, TOverlayExtensions>) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    onUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    once<K extends keyof W3BoosterEventMap<TSettings, TOverlayExtensions>>(type: K, listener: (data: W3BoosterEventMap<TSettings, TOverlayExtensions>[K]) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    once(type: '*', listener: (event: W3BoosterEvent<TSettings, TOverlayExtensions>) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    onceUnknown(type: string, listener: (data: unknown) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    off<K extends keyof W3BoosterEventMap<TSettings, TOverlayExtensions>>(type: K, listener: (data: W3BoosterEventMap<TSettings, TOverlayExtensions>[K]) => void): void;
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
export interface HostActionOptions {
    /** Cancels only this pending host request. */
    readonly signal?: AbortSignal;
    /** Acknowledgement timeout in milliseconds. Defaults to 10 seconds. */
    readonly timeout?: number;
}
export interface HostCommandOptions<TResult> extends HostActionOptions {
    /** Validate and transform the untrusted host acknowledgement value. */
    readonly parse: (value: unknown) => TResult;
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
    [TKey in StringKey<TSettings>]: NonNullable<TSettings[TKey]> extends readonly unknown[] ? TKey : NonNullable<TSettings[TKey]> extends object ? TKey | `${TKey}.${SettingsPath<NonNullable<TSettings[TKey]>>}` : TKey;
}[StringKey<TSettings>];
export type SettingsPathValue<TSettings, TPath extends string> = string extends keyof TSettings ? Exclude<TSettings[string & keyof TSettings], undefined> : TPath extends `${infer TKey}.${infer TRest}` ? TKey extends keyof TSettings ? SettingsPathValue<NonNullable<TSettings[TKey]>, TRest> : never : TPath extends keyof TSettings ? Exclude<TSettings[TPath], undefined> : never;
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
    refreshCapabilities(options?: HostActionOptions): Promise<readonly HostCapability[]>;
    subscribeCapabilities(listener: (capabilities: readonly HostCapability[], status: HostCapabilityStatus) => void | Promise<void>, options?: SubscriptionOptions): () => void;
    openWindow(options?: OpenWindowOptions, actionOptions?: HostActionOptions): Promise<void>;
    closeWindow(options?: HostActionOptions): Promise<void>;
    changeMatchScore(side: MatchScoreSide, delta: 1 | -1, options?: HostActionOptions): Promise<void>;
    resetMatchScore(options?: HostActionOptions): Promise<void>;
    command<TResult>(command: string, payload: JsonValue | undefined, options: HostCommandOptions<TResult>): Promise<TResult>;
    /** @deprecated Supply `options.parse` to validate a typed acknowledgement. Retained for SDK 1 source compatibility. */
    command<TResult>(command: string, payload?: JsonValue, options?: HostActionOptions): Promise<TResult>;
    command(command: string, payload?: JsonValue, options?: HostActionOptions): Promise<unknown>;
    /** Persist a setting and resolve only after the host confirms the saved settings. */
    setSetting<TPath extends SettingsPath<TSettings>>(path: TPath, value: SettingsPathValue<TSettings, TPath>, options?: HostActionOptions): Promise<DeepReadonly<TSettings>>;
    startAutoResize(): void;
    stopAutoResize(): void;
}
export interface PermissionRequiredError extends Error {
    readonly code: 'PERMISSION_REQUIRED';
    readonly authorizeUrl?: string;
}
export interface ConnectionError extends Error {
    readonly causes: readonly unknown[];
    readonly code: ConnectionErrorCode;
    readonly status?: number;
}
export interface ProtocolError extends Error {
    readonly code: string;
    readonly details?: unknown;
}
export interface HostActionError extends Error {
    readonly code: string;
}
export type ClientOptionsInput<TSettings extends object, TOverlayExtensions extends object> = TSettings extends JsonObjectInput<TSettings> ? TOverlayExtensions extends OverlayExtensionsInput<TOverlayExtensions> ? ConnectOptions<TSettings, TOverlayExtensions> | string : never : never;
/** Runtime error constructors exposed for `instanceof` and explicit error creation. */
export declare const PermissionRequiredError: {
    new (message: string, authorizeUrl?: string): PermissionRequiredError;
    readonly prototype: PermissionRequiredError;
};
export declare const ConnectionError: {
    new (message: string, causes?: unknown[], code?: ConnectionErrorCode, status?: number): ConnectionError;
    readonly prototype: ConnectionError;
};
export declare const ProtocolError: {
    new (code: string, message: string, details?: unknown): ProtocolError;
    readonly prototype: ProtocolError;
};
export declare const HostActionError: {
    new (message: string, code?: string): HostActionError;
    readonly prototype: HostActionError;
};
/** Runtime class identity for `instanceof`; clients are created through the factory functions. */
export declare const W3BoosterClient: {
    readonly prototype: W3BoosterClient;
    [Symbol.hasInstance](value: unknown): boolean;
};
/** Open a W3Booster transport without waiting for hydrated state. */
export declare function openClient<TSettings extends object = JsonObject, TOverlayExtensions extends object = object>(options: ClientOptionsInput<TSettings, TOverlayExtensions>): Promise<W3BoosterClient<TSettings, TOverlayExtensions>>;
/** @deprecated Use openClient() for transport-only startup or startClient() for synchronized state. */
export declare function connect<TSettings extends object = JsonObject, TOverlayExtensions extends object = object>(options: ClientOptionsInput<TSettings, TOverlayExtensions>): Promise<W3BoosterClient<TSettings, TOverlayExtensions>>;
/** Create a client and wait for the frontend lifecycle milestone requested by startup options. */
export declare function startClient<TSettings extends object = JsonObject, TOverlayExtensions extends object = object>(options: ClientOptionsInput<TSettings, TOverlayExtensions>, startup?: StartupOptions): Promise<W3BoosterClient<TSettings, TOverlayExtensions>>;
/** Create a client synchronously so lifecycle listeners can be attached before connecting. */
export declare function createClient<TSettings extends object = JsonObject, TOverlayExtensions extends object = object>(options: ClientOptionsInput<TSettings, TOverlayExtensions>): W3BoosterClient<TSettings, TOverlayExtensions>;
export declare function isAbortError(error: unknown): error is AbortError;
export declare function isW3BoosterError(error: unknown): error is PermissionRequiredError | ConnectionError | ProtocolError | HostActionError;
export declare function classifyW3BoosterError(error: unknown): W3BoosterErrorInfo;
export declare function canUseHostCapability(snapshot: HostLifecycleSnapshot, capability: HostCapability): boolean;
export declare const UNAVAILABLE_HOST_SNAPSHOT: HostLifecycleSnapshot;
export {};
