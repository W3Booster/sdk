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
