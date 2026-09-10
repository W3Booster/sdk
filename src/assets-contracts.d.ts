export interface AssetUrlOptions {
  readonly baseUrl?: string;
}
export interface AssetLaunchLocation { readonly search?: string }
export interface ResolveAssetBaseUrlOptions extends AssetUrlOptions {
  /** Launch location to inspect. Defaults to globalThis.location. */
  readonly location?: AssetLaunchLocation | null;
}

export const assetBaseUrl: 'https://static.w3booster.com/assets';
export const countryFlagCatalogVersion: 'v1';

export function resolveAssetBaseUrl(options?: ResolveAssetBaseUrlOptions): string;
export function normalizeAssetBaseUrl(value: string): string;
export function countryFlagFileName(country: string | null | undefined): string | undefined;
export function countryFlagUrl(country: string | null | undefined, options?: AssetUrlOptions): string | undefined;
export function countryFlagManifestUrl(options?: AssetUrlOptions): string;

/** Warcraft's Battle.net division ID, independent of W3Champions league IDs. */
export type BnetDivision = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface BnetLeagueIconOptions extends AssetUrlOptions {
  /** Compact game artwork by default. Unplaced (0) only has a standard badge. */
  readonly variant?: 'standard' | 'simplified';
}
export const bnetLeagueCatalogVersion: 'v1';
/** Unknown/missing division IDs return undefined. Does not infer division from MMR. */
export function bnetLeagueIconUrl(division: number | null | undefined, options?: BnetLeagueIconOptions): string | undefined;
export function bnetLeagueManifestUrl(options?: AssetUrlOptions): string;
