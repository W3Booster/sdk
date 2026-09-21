import type { MatchState } from './contracts.js';
import type { GameData } from './game-data-contracts.js';
export type LossKind = 'unit-lost' | 'building-lost' | 'item-used' | 'item-sold';
/** The counter changed in (fromGameTime, gameTime]; timestamps are observation times. */
export interface LossEvent {
  readonly playerId: string;
  readonly typeId: string;
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
  /** Null means at least one included event has an unknown cost. Static catalog estimates, not measured spend. */
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
  economy(playerId: string): readonly EconomySample[];
  /** Window ends at the latest pushed game time. Exact build-matched catalog is optional. */
  window(playerId: string, seconds: number, data?: GameData, options?: LossWindowOptions): LossWindow;
}
/** Optional framework-neutral current-match history. No timers, transport or persistence. */
export function createMatchHistory(options?: MatchHistoryOptions): MatchHistory;
