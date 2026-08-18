import type { Player, PlayerStats, Race, ValuePool } from './index.js';

export interface StandardGameRaceMetadata {
  readonly name: string;
  readonly shortName: string;
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

export const races: Readonly<Record<Race, StandardGameRaceMetadata>>;
export const playerColors: readonly string[];
export const weaponOrArmorUpgradeRawcodes: readonly string[];
export const meleeModes: Readonly<Record<StandardGameMode, StandardGameModeMetadata>>;

export function normalizeMode(mode: string | undefined): string;
export function isMode(mode: string | undefined, expected: string): boolean;
export function modeInfo(mode: string | undefined): StandardGameModeMetadata | undefined;
export function raceName(race?: Race): string;
export function raceShortName(race?: Race): string;
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
export function orderHeadToHeadPlayers<TPlayer extends Pick<Player, 'startPosition'>>(
  players: readonly TPlayer[],
  options?: { readonly reverse?: boolean }
): TPlayer[];
