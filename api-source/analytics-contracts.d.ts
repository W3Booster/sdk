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
