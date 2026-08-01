import type { HeroAbility, Player, PlayerStats, Race } from './index.js';

export interface StandardGameObjectMetadata {
  readonly icon?: string;
  readonly [field: string]: string | undefined;
}

export interface StandardGameRaceMetadata {
  readonly name: string;
  readonly shortName: string;
}

export type WarcraftGraphics = 'classic' | 'reforged';
export interface AssetUrlOptions {
  readonly graphics?: WarcraftGraphics;
  readonly baseUrl?: string;
}

export interface AbilityCooldownState {
  readonly total: number;
  readonly elapsed: number;
  readonly remaining: number;
  readonly progress: number;
  readonly active: boolean;
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

/** Shipped Warcraft III object metadata keyed by four-character rawcode. */
export const objects: Readonly<Record<string, StandardGameObjectMetadata>>;
export const races: Readonly<Record<Race, StandardGameRaceMetadata>>;
export const playerColors: readonly string[];
export const weaponOrArmorUpgradeRawcodes: readonly string[];
export const assetBaseUrl: 'https://assets.w3booster.com';
export const assetCatalogVersion: 'v1';

export function getObject(rawcode: string): StandardGameObjectMetadata | undefined;
export function getIcon(rawcode: string): string | undefined;
export function iconFileName(identifier: string): string | undefined;
export function iconUrl(identifier: string, options?: AssetUrlOptions): string | undefined;
export function assetManifestUrl(options?: Pick<AssetUrlOptions, 'baseUrl'>): string;
export function getAbilityCooldown(rawcode: string, level?: number): number | undefined;
export function numberField(rawcode: string, field: string): number | undefined;
export function normalizeMode(mode: string | undefined): string;
export function isMode(mode: string | undefined, expected: string): boolean;
export function raceName(race?: Race): string;
export function raceShortName(race?: Race): string;
export function playerColor(colorId?: number): string;
export function normalizeUpgradeRawcode(rawcode: string): string;
export function isWeaponOrArmorUpgrade(rawcode: string): boolean;
export function statsForMode(player: Player, mode?: string): PlayerStats | undefined;
export function abilityCooldown(ability: HeroAbility, gameTime: number): AbilityCooldownState | undefined;
export function dayNightState(gameTime: number): DayNightState;
export function heroExperienceState(experience?: number): HeroExperienceState;
