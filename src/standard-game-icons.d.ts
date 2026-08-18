import type { CompletedUpgrade, Hero, HeroAbility, Match } from './index.js';

export type WarcraftGraphics = 'classic' | 'reforged';
export interface AssetUrlOptions { readonly graphics?: WarcraftGraphics; readonly baseUrl?: string }
export const assetBaseUrl: 'https://static.w3booster.com/assets';
export const assetCatalogVersion: 'v1';
export function getIcon(rawcode: string): string | undefined;
export function iconFileName(identifier: string): string | undefined;
export function iconUrl(identifier: string, options?: AssetUrlOptions): string | undefined;
export function heroIconUrl(hero: Pick<Hero, 'id'> | null | undefined, options?: AssetUrlOptions): string | undefined;
export function abilityIconUrl(ability: Pick<HeroAbility, 'name'> | null | undefined, options?: AssetUrlOptions): string | undefined;
export function upgradeIconUrl(upgrade: Pick<CompletedUpgrade, 'name'> | null | undefined, options?: AssetUrlOptions): string | undefined;
export function itemIconUrl(rawcode: string | null | undefined, options?: AssetUrlOptions): string | undefined;
export function assetManifestUrl(options?: Pick<AssetUrlOptions, 'baseUrl'>): string;
export interface StandardGameAssetResolver {
  icon(match: Pick<Match, 'isReforged'>, identifier: string): string | undefined;
  hero(match: Pick<Match, 'isReforged'>, hero: Pick<Hero, 'id'> | null | undefined): string | undefined;
  ability(match: Pick<Match, 'isReforged'>, ability: Pick<HeroAbility, 'name'> | null | undefined): string | undefined;
  upgrade(match: Pick<Match, 'isReforged'>, upgrade: Pick<CompletedUpgrade, 'name'> | null | undefined): string | undefined;
  item(match: Pick<Match, 'isReforged'>, rawcode: string | null | undefined): string | undefined;
}
export function createAssetResolver(options?: Pick<AssetUrlOptions, 'baseUrl'>): StandardGameAssetResolver;
