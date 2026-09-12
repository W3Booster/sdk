import type { HeroAbility, MatchState, TimedProgress } from './contracts.js';
export type Graphics = 'classic' | 'reforged';
export type ObjectKind = 'units' | 'abilities' | 'items' | 'upgrades';
export interface ObjectType {
  readonly typeId: string;
  readonly name?: string;
  readonly race?: string;
}
export interface Cost { readonly gold?: number; readonly lumber?: number }
export interface UnitType extends ObjectType {
  readonly cost: Cost;
  readonly supply: { readonly used?: number; readonly provided?: number };
  readonly baseStats: { readonly hitpoints?: number; readonly mana?: number; readonly initialMana?: number; readonly armor?: number; readonly movementSpeed?: number; readonly hitpointRegeneration?: number; readonly manaRegeneration?: number; readonly strength?: number; readonly agility?: number; readonly intelligence?: number };
  readonly buildTimeSeconds?: number;
  readonly isBuilding: boolean;
  readonly abilities: readonly string[];
  readonly heroAbilities: readonly string[];
  readonly upgrades: readonly string[];
  readonly trains: readonly string[];
  readonly builds: readonly string[];
}
export interface AbilityType extends ObjectType {
  readonly maxLevel: number;
  readonly isHeroAbility: boolean;
  readonly requiredHeroLevel: number;
  readonly levels: readonly { readonly cooldownSeconds?: number; readonly manaCost?: number; readonly castTimeSeconds?: number; readonly range?: number }[];
}
export interface ItemType extends ObjectType { readonly cost: Cost; readonly abilities: readonly string[] }
export interface UpgradeType extends ObjectType {
  readonly maxLevel: number;
  readonly category: string;
  readonly levels: readonly { readonly level: number; readonly name?: string; readonly cost: Cost; readonly timeSeconds?: number }[];
}
export interface TypeCatalog<T> { get(typeId: string): T | undefined; has(typeId: string): boolean; values(): readonly T[] }
export interface IconOptions { readonly graphics: Graphics; readonly level?: number; readonly role?: 'icon' | 'research' | 'inactive' }
export interface GameData {
  readonly id: string;
  readonly gameVersion: string;
  readonly ruleset: 'current-melee';
  readonly units: TypeCatalog<UnitType>;
  readonly abilities: TypeCatalog<AbilityType>;
  readonly items: TypeCatalog<ItemType>;
  readonly upgrades: TypeCatalog<UpgradeType>;
  readonly assets: {
    icon(kind: ObjectKind, typeId: string, options: IconOptions): string | undefined;
    unitIcon(typeId: string, options: IconOptions): string | undefined;
    abilityIcon(typeId: string, options: IconOptions): string | undefined;
    itemIcon(typeId: string, options: IconOptions): string | undefined;
    upgradeIcon(typeId: string, options: IconOptions): string | undefined;
  };
  /** Optional broad gameplay projection. Static source values, not observed unit stats. */
  unitGameplay(typeId: string, options?: { signal?: AbortSignal }): Promise<Readonly<Record<string, Readonly<Record<string, string>>>> | undefined>;
}
export interface GameDataLoadOptions { readonly baseUrl?: string; readonly signal?: AbortSignal; readonly fetch?: typeof globalThis.fetch }
/** Loads only the exact revision advertised by the recorder; never substitutes the latest build. */
export function loadGameData(id: string, options?: GameDataLoadOptions): Promise<GameData>;
export interface AbilityCooldownState extends TimedProgress { readonly active: boolean; readonly totalSeconds: number; readonly remainingSeconds: number; readonly progress: number }
/** A standard-game estimate derived from this revision's ability configuration and observed game time. */
export function abilityCooldown(ability: HeroAbility, gameTime: number, data: GameData): AbilityCooldownState | undefined;
export function abilityCooldownsForState(state: Pick<MatchState, 'match' | 'players'>, data: GameData): ReadonlyMap<HeroAbility, AbilityCooldownState>;
