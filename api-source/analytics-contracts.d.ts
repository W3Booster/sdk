import type { MatchState } from './contracts.js';
import type { GameData } from './game-data-contracts.js';
export type LossKind = 'unit-lost' | 'building-lost' | 'hero-lost' | 'item-used' | 'item-sold';
/** The counter changed in (fromGameTime, gameTime]; timestamps are observation times. */
export interface LossEvent {
  readonly playerId: string;
  readonly typeId: string;
  /** Full hero instance ID, present for hero-lost events. */
  readonly heroId?: string;
  readonly kind: LossKind;
  readonly count: number;
  readonly fromGameTime: number;
  readonly gameTime: number;
}
export interface EconomySample {
  readonly gameTime: number;
  readonly goldMined: number;
  readonly goldUpkeepLost: number;
  readonly netGold: number;
}
export interface LossWindow {
  readonly fromGameTime: number;
  readonly toGameTime: number;
  readonly events: readonly LossEvent[];
  readonly counts: Readonly<Record<LossKind, Readonly<Record<string, number>>>>;
  /** Static catalog estimates, not measured spend. Hero deaths are excluded from all cost totals; revival cost is not observed. Null means an included non-hero event has an unknown cost. */
  readonly cost: { readonly gold: number | null; readonly lumber: number | null; readonly food: number | null };
  /** Entire requested interval has retained, continuous counter observations for all requested lanes. */
  readonly covered: boolean;
  /** Deaths are sampled; true coverage does not imply that every death was captured. */
  readonly complete: boolean;
  /** Some included events may fall before the requested start within their observation interval. */
  readonly boundaryUncertain: boolean;
}
export interface MatchHistoryOptions {
  /** Defaults: 7200 game seconds, 15000 economic samples/player, 20000 events total. */
  readonly maxSeconds?: number;
  readonly maxSamples?: number;
  readonly maxEvents?: number;
  /** Monotonic milliseconds; defaults to performance.now. Supply recorded receipt times when processing snapshots offline. No timer is started. */
  readonly now?: () => number;
}
export interface LossWindowOptions {
  readonly kinds?: readonly LossKind[];
  /** Actual sale proceeds as a fraction of purchase price. Omit to leave sold-item cost unknown. */
  readonly soldItemRefundRate?: number;
}
export interface MatchHistory {
  /** Push each authorized state. First observation establishes a baseline, not historical events. */
  push(state: MatchState): void;
  /** Call on disconnect/gaps. Match changes, rewinds and scope/mode changes reset automatically. */
  reset(): void;
  /** Contiguous observed economy history. Freshness accounts for observed replay speed, bounded by five unpaused real seconds without a new sample timestamp. Missing fields still clear immediately. Compare players at matching sample times. */
  economy(playerId: string): readonly EconomySample[];
  /** Window ends at the latest pushed game time. Exact build-matched catalog is optional. */
  window(playerId: string, seconds: number, data?: GameData, options?: LossWindowOptions): LossWindow;
}
/** Optional framework-neutral current-match history. No timers, transport or persistence. */
export function createMatchHistory(options?: MatchHistoryOptions): MatchHistory;

export interface UnitContributionQuery {
  readonly playerId?: string;
  readonly unitId?: string;
  readonly typeId?: string;
}
export interface UnitContributions {
  readonly damageDealt: number;
  readonly damageReceived: number;
  readonly healingDone: number;
  /** Unit retention capacity was exceeded; results are partial until reset. */
  readonly truncated: boolean;
}
/** One retained player/type attribution for a full unit instance ID. */
export interface UnitContributionEntry {
  readonly playerId: string;
  readonly unitId: string;
  readonly typeId: string;
  readonly damageDealt: number;
  readonly damageReceived: number;
  readonly healingDone: number;
  readonly firstObservedGameTime: number;
  readonly lastObservedGameTime: number;
  /** Last observed alive flag; disappearance never implies death. */
  readonly alive: boolean;
  /** Presence in the latest complete collection. Absent while the feed is unavailable. */
  readonly present?: boolean;
}
export interface UnitContributionEvent {
  readonly playerId: string;
  readonly unitId: string;
  readonly typeId: string;
  readonly fromGameTime: number;
  readonly gameTime: number;
  readonly damageDealt: number;
  readonly damageReceived: number;
  readonly healingDone: number;
}
export interface UnitContributionWindow extends UnitContributions {
  readonly fromGameTime: number;
  readonly toGameTime: number;
  readonly events: readonly UnitContributionEvent[];
  readonly covered: boolean;
  /** Sampled counters never guarantee every intervening attribution. */
  readonly complete: false;
  readonly boundaryUncertain: boolean;
}
export interface UnitHistoryOptions {
  /** Defaults: 8192 instances, 20000 intervals/events, 7200 game seconds. */
  readonly maxUnits?: number;
  readonly maxEvents?: number;
  readonly maxSeconds?: number;
  /** Monotonic receipt milliseconds for offline processing. No timer is started. */
  readonly now?: () => number;
}
export interface UnitHistory {
  /** First observation and observations after gaps/transfers/transformations establish baselines. */
  push(state: MatchState): void;
  /** Call on disconnect. Match, rewind, catalog, mode and permission changes reset automatically. */
  reset(): void;
  /** Positive counter deltas observed since attachment, retained after corpse removal and timed-event expiry. */
  contributions(query?: UnitContributionQuery): UnitContributions;
  /** Retained identities and observed contributions, including zero-contribution units. Apps choose their grouping/count/cost policy. */
  entries(query?: UnitContributionQuery): readonly UnitContributionEntry[];
  /** Query a trailing window. Events span observation intervals, not exact combat timestamps. */
  window(seconds: number, query?: UnitContributionQuery): UnitContributionWindow;
}
/** Optional bounded unit contribution history; costs and application-specific grouping remain app-side. */
export function createUnitHistory(options?: UnitHistoryOptions): UnitHistory;
