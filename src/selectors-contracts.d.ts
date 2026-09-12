import type { ActiveUpgrade, Capability, GameContext, Unit, Building, Hero, Match, MatchState, Player, Resources } from './index.js';

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
/** Unit selectors exclude illusions unless explicitly requested; raw collections retain all instances. */
export interface UnitSelectionOptions { readonly includeIllusions?: boolean }
/** Ascending full instance ID; deterministic, not a creation-time or native-slot order. */
export function playerUnits(player: Pick<Player, 'units'> | null | undefined, options?: UnitSelectionOptions): readonly Unit[];
/** Ascending full instance ID; deterministic, not a creation-time or native-slot order. */
export function playerBuildings(player: Pick<Player, 'buildings'> | null | undefined, options?: UnitSelectionOptions): readonly Building[];
/** Ascending full instance ID; deterministic, not a creation-time or native-slot order. */
export function playerHeroes(player: Pick<Player, 'heroes'> | null | undefined, options?: UnitSelectionOptions): readonly Hero[];
export function playerResources(player: Pick<Player, 'resources'> | null | undefined): Readonly<Resources> | undefined;
export function playerResourcesOrZero(player: Pick<Player, 'resources'> | null | undefined): Readonly<Resources>;
/** Shared game context with a stable scale-1 fallback before hydration. No scope required. */
export function gameContext<TSettings extends object>(state: Pick<MatchState<TSettings>, 'gameContext'> | null | undefined): GameContext;
export function inventorySlotIdentity(index: number, item: string | null | undefined): string;
export function upgradeIdentity(upgrade: Pick<ActiveUpgrade, 'typeId' | 'level'>): string;
export function currentUpgrades(
  player: Pick<Player, 'upgrades'> | null | undefined,
  options?: { readonly includeResearching?: boolean }
): readonly ActiveUpgrade[];
export function battleTagName(name?: string): string | undefined;
