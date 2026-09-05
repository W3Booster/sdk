import type { ActiveUpgrade, Capability, GameContext, Hero, Match, MatchScore, MatchState, OverlayRuntimeState, Player, Resources } from './index.js';

export function isActiveMatch(match: Pick<Match, 'status'> | null | undefined): boolean;
export function isObserverOrReplayMatch(match: Pick<Match, 'isObserver' | 'isReplay'> | null | undefined): boolean;
export function hasCapability<TSettings extends object>(state: Pick<MatchState<TSettings>, 'capabilities'> | null | undefined, capability: Capability): boolean;
export function broadcasterPlayer<TPlayer extends Pick<Player, 'id'>>(
  match: Pick<Match, 'broadcasterPlayerId'> | null | undefined,
  players: readonly TPlayer[],
  options?: { readonly fallbackToFirst?: boolean }
): TPlayer | null;
export function headToHeadPair<TPlayer>(
  players: readonly TPlayer[]
): readonly [TPlayer, TPlayer] | null;
export interface TeamAssignable { readonly team?: number | null }
export interface PlayerTeam<TPlayer extends TeamAssignable = Player> {
  readonly teamId: number | null;
  readonly players: readonly TPlayer[];
}
export type PlayerRelationship = 'self' | 'ally' | 'opponent' | 'unknown';
export function groupPlayersByTeam<TPlayer extends TeamAssignable>(
  players: readonly TPlayer[]
): readonly PlayerTeam<TPlayer>[];
export function broadcasterFirstTeams<TPlayer extends TeamAssignable & Pick<Player, 'id'>>(
  players: readonly TPlayer[],
  match: Pick<Match, 'broadcasterPlayerId'> | null | undefined,
  options?: { readonly reverse?: boolean }
): readonly PlayerTeam<TPlayer>[];
export function playerRelationship(
  player: Player | null | undefined,
  match: Pick<Match, 'broadcasterPlayerId'> | null | undefined,
  players: readonly Player[]
): PlayerRelationship;
export interface PlayerDisplayIdentity {
  readonly primaryName: string;
  readonly inGameName: string;
  readonly accountName?: string;
  readonly hasAlias: boolean;
}
export function playerDisplayIdentity(
  player: Pick<Player, 'id' | 'name' | 'mainAccount'> | null | undefined,
  options?: { readonly stripBattleTagDiscriminator?: boolean }
): PlayerDisplayIdentity;
export function heroInventory(hero: Pick<Hero, 'inventory'> | null | undefined): readonly string[];
export function playerHeroes(player: Pick<Player, 'heroes'> | null | undefined): readonly Hero[];
export function playerResources(player: Pick<Player, 'resources'> | null | undefined): Readonly<Resources> | undefined;
export function playerResourcesOrZero(player: Pick<Player, 'resources'> | null | undefined): Readonly<Resources>;
/** Shared game context with a stable scale-1 fallback before hydration. No scope required. */
export function gameContext<TSettings extends object>(state: Pick<MatchState<TSettings>, 'gameContext'> | null | undefined): GameContext;
/** @deprecated Use gameContext(). */
export function overlayRuntime<TSettings extends object>(
  state: Pick<MatchState<TSettings>, 'overlay'> | null | undefined
): OverlayRuntimeState;
/** @deprecated App-owned scores belong in application.data. Kept for released consumers. */
export function matchScore<TSettings extends object>(
  state: Pick<MatchState<TSettings>, 'overlay'> | null | undefined
): MatchScore | undefined;
/** @deprecated App-owned scores belong in application.data. */
export function matchScoreOrZero<TSettings extends object>(
  state: Pick<MatchState<TSettings>, 'overlay'> | null | undefined
): MatchScore;
export function inventorySlotIdentity(index: number, item: string | null | undefined): string;
export function upgradeIdentity(upgrade: Pick<ActiveUpgrade, 'name' | 'level'>): string;
export function currentUpgrades(
  player: Pick<Player, 'upgrades'> | null | undefined,
  options?: { readonly includeResearching?: boolean }
): readonly ActiveUpgrade[];
export function battleTagName(name?: string): string | undefined;
