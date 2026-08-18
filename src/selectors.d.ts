import type { ActiveUpgrade, Capability, Hero, Match, MatchScore, MatchState, OverlayRuntimeState, Player, Resources } from './index.js';

export function isActiveMatch(match: Pick<Match, 'status'> | null | undefined): boolean;
export function isObserverOrReplayMatch(match: Pick<Match, 'isObserver' | 'isReplay'> | null | undefined): boolean;
export function hasCapability<TSettings extends object>(state: Pick<MatchState<TSettings>, 'capabilities'> | null | undefined, capability: Capability): boolean;
export function broadcasterPlayer(
  match: Pick<Match, 'broadcasterPlayerId'> | null | undefined,
  players: readonly Player[],
  options?: { readonly fallbackToFirst?: boolean }
): Player | null;
export interface PlayerTeam {
  readonly teamId: number | null;
  readonly players: readonly Player[];
}
export type PlayerRelationship = 'self' | 'ally' | 'opponent' | 'unknown';
export function groupPlayersByTeam(players: readonly Player[]): PlayerTeam[];
export function broadcasterFirstTeams(
  players: readonly Player[],
  match: Pick<Match, 'broadcasterPlayerId'> | null | undefined,
  options?: { readonly reverse?: boolean }
): PlayerTeam[];
export function playerRelationship(
  player: Player | null | undefined,
  match: Pick<Match, 'broadcasterPlayerId'> | null | undefined,
  players: readonly Player[]
): PlayerRelationship;
export function heroInventory(hero: Pick<Hero, 'inventory'> | null | undefined): readonly string[];
export function playerHeroes(player: Pick<Player, 'heroes'> | null | undefined): readonly Hero[];
export function playerResources(player: Pick<Player, 'resources'> | null | undefined): Readonly<Resources>;
export function overlayRuntime<TSettings extends object>(
  state: Pick<MatchState<TSettings>, 'overlay'> | null | undefined
): OverlayRuntimeState;
export function matchScore<TSettings extends object>(
  state: Pick<MatchState<TSettings>, 'overlay'> | null | undefined
): MatchScore;
export function inventorySlotIdentity(index: number, item: string | null | undefined): string;
export function upgradeIdentity(upgrade: Pick<ActiveUpgrade, 'name' | 'level'>): string;
export function currentUpgrades(
  player: Pick<Player, 'upgrades'> | null | undefined,
  options?: { readonly includeResearching?: boolean }
): ActiveUpgrade[];
export function battleTagName(name?: string): string | undefined;
