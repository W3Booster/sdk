import type { Hero, Match, Player } from './index.js';

export function isActiveMatch(match: Pick<Match, 'status'> | null | undefined): boolean;
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
export function playerRelationship(
  player: Player | null | undefined,
  match: Pick<Match, 'broadcasterPlayerId'> | null | undefined,
  players: readonly Player[]
): PlayerRelationship;
export function heroInventory(hero: Pick<Hero, 'items' | 'inventory'> | null | undefined): readonly string[];
export function battleTagName(name?: string): string | undefined;
