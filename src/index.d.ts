export const SDK_VERSION: '0.2.0';
export const PROTOCOL_VERSION: '1.0';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly ['1.0'];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

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

export interface ConnectOptions<TSettings = JsonObject> {
  clientId: string;
  /** Cancels the initial connection attempt. It does not disconnect an already connected client. */
  signal?: AbortSignal;
  /** Uses the scopes configured for the app by default. Pass an array only to request a smaller subset. */
  scopes?: Scope[] | 'configured';
  demo?: boolean | { interval?: number; state?: MatchState<TSettings> };
  /** Defaults to cloud. A platform-provided backend=local|cloud launch parameter takes precedence; applications do not parse it themselves. */
  backend?: 'auto' | 'local' | 'cloud' | string;
  tokenProvider?: () => string | null | Promise<string | null>;
  localApi?: string;
  cloudApi?: string;
  /** Prefer the recorder's low-latency observer/replay feed when the platform exposes one. Defaults to true. */
  localRecorder?: boolean;
}

export interface ApplicationState<TSettings = JsonObject> {
  clientId: string;
  settings: TSettings;
  surface?: AppSurface;
  development?: boolean;
}
/** Runtime information produced by the recorder for overlay-capable apps. */
export interface OverlayRuntimeState {
  [key: string]: JsonValue | undefined;
  chatbarOpen?: boolean;
  hudScale?: number;
  matchscoreWins?: number;
  matchscoreLosses?: number;
  teamColors?: boolean;
}
export interface OverlayState {
  settings: JsonObject;
  misc: OverlayRuntimeState;
}
export interface MatchState<TSettings = JsonObject> {
  capabilities: Capability[];
  match: Match;
  players: Player[];
  overlay?: OverlayState;
  application?: ApplicationState<TSettings>;
  /** Additive protocol extensions are preserved by the SDK. */
  [key: string]: unknown;
}
export interface Match {
  id: string;
  status: MatchStatus;
  gameTime: number;
  mode: string;
  map?: string;
  realm?: string;
  paused?: boolean;
  isReplay?: boolean;
  isReforged?: boolean;
  isObserver?: boolean;
  broadcasterPlayerId?: string;
  realBroadcasterPlayerId?: string;
  /** ISO-8601 timestamp serialized by the API. */
  startedAt?: string;
  [key: string]: unknown;
}
export interface Point { x: number; y: number }
export interface Resources { gold: number; lumber: number; supply: number; supplyCap: number; workerSupply?: number }
export interface PlayerStats { wins: number; losses: number; winRate: number; rank?: number; league?: string | number; level?: number }
export interface PlayerStatsCollection { solo?: PlayerStats; team?: PlayerStats; team4?: PlayerStats; ffa?: PlayerStats }
export interface MainAccount { name: string; country?: string; mainRace?: Race | number }
export interface ControlGroup { frontunit: string; size: number }
export interface ValuePool { current: number; max: number }
export interface HeroAbility { id: string; name: string; level: number; lastActivation?: number }
export interface Hero {
  id: string;
  name: string;
  level: number;
  experience?: number;
  hitpoints?: ValuePool;
  mana?: ValuePool;
  abilities?: HeroAbility[];
  inventory?: string[];
  [key: string]: unknown;
}
export interface CompletedUpgrade { name: string; level: number; gametime: number }
export interface ActiveUpgrade extends CompletedUpgrade {}
export interface ResearchingUpgrade extends ActiveUpgrade { researchStart?: string; researchFinish?: string }
export interface UpgradeState {
  upgrades: CompletedUpgrade[];
  active: ActiveUpgrade[];
  researching: ResearchingUpgrade[];
}
export interface Player {
  id: string;
  name?: string;
  race?: Race;
  team?: number;
  colorId?: number;
  startPosition?: Point;
  isAI?: boolean;
  mainAccount?: MainAccount;
  controlgroups?: Record<string, ControlGroup>;
  resources?: Resources;
  heroes?: Hero[];
  upgrades?: UpgradeState;
  stats?: PlayerStatsCollection;
  [key: string]: unknown;
}

export interface JsonPatchAdd { op: 'add'; path: string; value: JsonValue }
export interface JsonPatchReplace { op: 'replace'; path: string; value: JsonValue }
export interface JsonPatchRemove { op: 'remove'; path: string }
export type JsonPatchOperation = JsonPatchAdd | JsonPatchReplace | JsonPatchRemove;
export interface ProtocolEnvelope<TType extends string = string, TData = unknown> {
  version: string;
  sequence: number;
  type: TType;
  data: TData;
}
export type SnapshotMessage<TSettings = JsonObject> = ProtocolEnvelope<'state.snapshot', MatchState<TSettings>>;
export type PatchMessage = ProtocolEnvelope<'state.patch', JsonPatchOperation[]>;

export interface StateChangedEvent<TSettings = JsonObject> { state: MatchState<TSettings>; previousState: MatchState<TSettings> | null; initial: boolean }
export interface MatchChangedEvent<TSettings = JsonObject> { match: Match; previousMatch: Match; changedFields: string[]; state: MatchState<TSettings> }
export interface MatchLifecycleEvent<TSettings = JsonObject> { match: Match; previousMatch?: Match; nextMatch?: Match; state: MatchState<TSettings> }
export interface PlayerEvent<TSettings = JsonObject> { playerId: string; player: Player; previousPlayer?: Player; state: MatchState<TSettings> }
export interface PlayerChangedEvent<TSettings = JsonObject> extends PlayerEvent<TSettings> { changedFields: string[] }
export interface HeroEvent<TSettings = JsonObject> extends PlayerEvent<TSettings> { heroId: string; hero: Hero; previousHero?: Hero }
export interface HeroChangedEvent<TSettings = JsonObject> extends HeroEvent<TSettings> { changedFields: string[] }
export interface W3BoosterEventMap<TSettings = JsonObject> {
  'state.ready': { state: MatchState<TSettings> };
  'state.changed': StateChangedEvent<TSettings>;
  'match.started': MatchLifecycleEvent<TSettings>;
  'match.changed': MatchChangedEvent<TSettings>;
  'match.ended': MatchLifecycleEvent<TSettings>;
  'player.added': PlayerEvent<TSettings>;
  'player.changed': PlayerChangedEvent<TSettings>;
  'player.removed': PlayerEvent<TSettings>;
  'player.resources.changed': PlayerEvent<TSettings> & { resources?: Resources; previousResources?: Resources };
  'player.stats.changed': PlayerEvent<TSettings> & { stats?: PlayerStatsCollection; previousStats?: PlayerStatsCollection };
  'player.upgrades.changed': PlayerEvent<TSettings> & { upgrades?: UpgradeState; previousUpgrades?: UpgradeState };
  'hero.added': HeroEvent<TSettings>;
  'hero.changed': HeroChangedEvent<TSettings>;
  'hero.removed': HeroEvent<TSettings>;
  'hero.inventory.changed': HeroEvent<TSettings> & { inventory: string[]; previousInventory: string[] };
  'hero.abilities.changed': HeroEvent<TSettings> & { abilities: HeroAbility[]; previousAbilities: HeroAbility[] };
  'application.settings.changed': { settings: TSettings; previousSettings: TSettings; application?: ApplicationState<TSettings>; state: MatchState<TSettings> };
  status: ConnectionStatus;
  error: unknown;
  'stream.gap': { expected: number; received: number };
  'state.snapshot': MatchState<TSettings>;
  'state.patch': JsonPatchOperation[];
}

export interface ReadyOptions { timeout?: number }
export class StateStore<TSettings = JsonObject> {
  /** Current hydrated state, or null until the first snapshot after connecting. */
  get(): MatchState<TSettings> | null;
  player(playerId: string | number): Player | null;
  /** Runs immediately when state already exists and after every later state update. */
  subscribe(listener: (state: MatchState<TSettings>) => void): () => void;
  /** Runs immediately for the first selected value, then only when its structural value changes. */
  watch<T>(selector: (state: MatchState<TSettings>) => T, listener: (value: T, previousValue: T | undefined, state: MatchState<TSettings>) => void): () => void;
  /** Wait for the first state snapshot. The default timeout is 10 seconds; zero disables the timeout. */
  whenReady(options?: ReadyOptions): Promise<MatchState<TSettings>>;
}
export class W3BoosterEventEmitter<TSettings = JsonObject> {
  on<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): () => void;
  on(type: '*', listener: (event: { type: keyof W3BoosterEventMap<TSettings>; data: W3BoosterEventMap<TSettings>[keyof W3BoosterEventMap<TSettings>] }) => void): () => void;
  on(type: string, listener: (data: unknown) => void): () => void;
  once<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): () => void;
  once(type: string, listener: (data: unknown) => void): () => void;
  off<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): void;
  off(type: string, listener: (data: unknown) => void): void;
}
export interface Diagnostics {
  sdkVersion: string;
  protocolVersion: string | null;
  transport: string | null;
  localTransport: 'recorder-local' | null;
}
export class W3BoosterClient<TSettings = JsonObject> {
  /** Complete platform state. */
  readonly state: StateStore<TSettings>;
  readonly events: W3BoosterEventEmitter<TSettings>;
  readonly host: W3BoosterHost;
  readonly diagnostics: Diagnostics;
  status: ConnectionStatus;
  constructor(options: ConnectOptions<TSettings> | string);
  connect(): Promise<this>;
  whenReady(options?: ReadyOptions): Promise<MatchState<TSettings>>;
  on<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): () => void;
  on(type: '*', listener: (event: { type: keyof W3BoosterEventMap<TSettings>; data: W3BoosterEventMap<TSettings>[keyof W3BoosterEventMap<TSettings>] }) => void): () => void;
  on(type: string, listener: (data: unknown) => void): () => void;
  once<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): () => void;
  once(type: string, listener: (data: unknown) => void): () => void;
  off<K extends keyof W3BoosterEventMap<TSettings>>(type: K, listener: (data: W3BoosterEventMap<TSettings>[K]) => void): void;
  off(type: string, listener: (data: unknown) => void): void;
  /** Close transports and clear hydrated state. Event subscriptions remain usable if this client reconnects. */
  disconnect(): Promise<void>;
}
export interface OpenWindowOptions { path?: string; width?: number; height?: number; title?: string }
export class W3BoosterHost {
  readonly available: boolean;
  openWindow(options?: OpenWindowOptions): boolean;
  command(command: string, payload?: unknown): boolean;
  setSetting(path: string, value: JsonValue): boolean;
  startAutoResize(): void;
  stopAutoResize(): void;
}
export class PermissionRequiredError extends Error { authorizeUrl?: string }
export class ConnectionError extends Error { causes: unknown[] }
export class ProtocolError extends Error { code: string; details?: unknown }
export function connect<TSettings = JsonObject>(options: ConnectOptions<TSettings> | string): Promise<W3BoosterClient<TSettings>>;
