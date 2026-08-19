import type { Hero, Match, OverlayRuntimeState, Player, PlayerStats, Race, ValuePool } from './index.js';
import type { PlayerTeam } from './selectors.js';

export interface StandardGameRaceMetadata {
  readonly localizationKey: `race.${Race}`;
  readonly shortLocalizationKey: `race.${Race}.short`;
}

export type StandardGameMode = '1v1' | '2v2' | '3v3' | '4v4' | '3ffa' | '4ffa';
export interface StandardGameModeMetadata {
  readonly id: StandardGameMode;
  readonly kind: 'head-to-head' | 'team' | 'ffa';
  readonly playerCount: number;
  readonly teamSize: number;
  readonly stats: 'solo' | 'team' | 'team4' | 'ffa';
}
export interface DayNightState {
  readonly hour: number;
  readonly isDay: boolean;
  readonly secondsIntoCycle: number;
  readonly cycleProgress: number;
}

export interface HeroExperienceState {
  readonly level: number;
  readonly experience: number;
  readonly levelStartExperience: number;
  readonly nextLevelExperience?: number;
  readonly experienceIntoLevel: number;
  readonly experienceForNextLevel: number;
  readonly progress: number;
}
export type UpkeepState = 'none' | 'low' | 'high';

export const races: Readonly<Record<Race, StandardGameRaceMetadata>>;
export const playerColors: readonly string[];
export const weaponOrArmorUpgradeRawcodes: readonly string[];
export const meleeModes: Readonly<Record<StandardGameMode, StandardGameModeMetadata>>;

export function raceInfo(race: string | undefined): StandardGameRaceMetadata;
export function normalizeMode(mode: string | undefined): string;
export function isMode(mode: string | undefined, expected: string): boolean;
export function modeInfo(mode: string | undefined): StandardGameModeMetadata | undefined;
export function playerColor(colorId?: number): string;
export function normalizeUpgradeRawcode(rawcode: string): string;
export function isWeaponOrArmorUpgrade(rawcode: string): boolean;
export function statsForMode(player: Player, mode?: string): PlayerStats | undefined;
export function preferredStats(player: Player, mode?: string): PlayerStats | undefined;
export function formatGameTime(gameTime: number, options?: { readonly compactHours?: boolean }): string;
export function dayNightState(gameTime: number): DayNightState;
export function heroExperienceState(experience?: number): HeroExperienceState;
export function valuePoolRatio(pool: Pick<ValuePool, 'current' | 'max'> | null | undefined, options?: { readonly clamp?: boolean }): number;
export function isValuePoolDepleted(pool: Pick<ValuePool, 'current'> | null | undefined): boolean;
export function upkeepState(supply: number | null | undefined): UpkeepState | undefined;
export function orderHeadToHeadPlayers<TPlayer extends Pick<Player, 'startPosition'>>(
  players: readonly [TPlayer, TPlayer],
  options?: { readonly reverse?: boolean }
): readonly [TPlayer, TPlayer];
export function orderHeadToHeadPlayers<TPlayer extends Pick<Player, 'startPosition'>>(
  players: readonly TPlayer[],
  options?: { readonly reverse?: boolean }
): readonly TPlayer[];
export function orderMatchTeams<TPlayer extends Pick<Player, 'id' | 'team' | 'startPosition'>>(
  players: readonly TPlayer[],
  match: Pick<Match, 'isObserver' | 'isReplay' | 'broadcasterPlayerId'> | null | undefined,
  options?: { readonly reverse?: boolean }
): readonly PlayerTeam<TPlayer>[];
export function presentationPlayerColor(
  player: Player | null | undefined,
  match: Pick<Match, 'broadcasterPlayerId' | 'isObserver'> | null | undefined,
  players: readonly Player[],
  runtime?: Pick<OverlayRuntimeState, 'teamColors'>
): string;
export function formatHeroLevelProgress(hero: Pick<Hero, 'level' | 'experience'> | null | undefined): string;
