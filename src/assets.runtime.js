const DEFAULT_ASSET_BASE_URL = 'https://static.w3booster.com/assets';
const COUNTRY_FLAG_CATALOG_VERSION = 'v1';

export const assetBaseUrl = DEFAULT_ASSET_BASE_URL;
export const countryFlagCatalogVersion = COUNTRY_FLAG_CATALOG_VERSION;

/** Resolve the asset origin advertised by a W3Booster launch. */
export function resolveAssetBaseUrl(options = {}) {
  const location = options.location === undefined ? globalThis.location : options.location;
  if (options.baseUrl !== undefined) return normalizeAssetBaseUrl(options.baseUrl);
  let parameters;
  try { parameters = new URLSearchParams(location?.search || ''); }
  catch (_) { return DEFAULT_ASSET_BASE_URL; }
  const advertised = parameters.get('assetBaseUrl');
  if (parameters.get('backend') !== 'local' || !advertised) return DEFAULT_ASSET_BASE_URL;
  try {
    const normalized = normalizeAssetBaseUrl(advertised);
    return isLoopbackHostname(new URL(normalized).hostname) ? normalized : DEFAULT_ASSET_BASE_URL;
  }
  catch (_) { return DEFAULT_ASSET_BASE_URL; }
}

/** Validate and normalize an explicit hosted or local asset mirror URL. */
export function normalizeAssetBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '')); }
  catch (_) { throw new TypeError('asset base URL must be a valid HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('asset base URL must use HTTP(S)');
  if (url.username || url.password) throw new TypeError('asset base URL may not contain credentials');
  if (url.search || url.hash) throw new TypeError('asset base URL may not contain a query or fragment');
  const local = isLoopbackHostname(url.hostname);
  if (url.protocol === 'http:' && !local) throw new TypeError('asset base URL must use HTTPS unless it targets localhost');
  return url.toString().replace(/\/$/, '');
}

function isLoopbackHostname(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

/** Normalize a country identifier to one safe filename in the hosted flag catalog. */
export function countryFlagFileName(country) {
  if (typeof country !== 'string') return undefined;
  const identifier = country.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier)
    ? `${identifier}.png`
    : undefined;
}

/** Stable URL for a country flag. The base URL can be replaced for local/offline hosting. */
export function countryFlagUrl(country, options = {}) {
  const filename = countryFlagFileName(country);
  if (!filename) return undefined;
  const baseUrl = normalizeAssetBaseUrl(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
  return `${baseUrl}/country-flags/${COUNTRY_FLAG_CATALOG_VERSION}/flags/${encodeURIComponent(filename)}`;
}

export function countryFlagManifestUrl(options = {}) {
  const baseUrl = normalizeAssetBaseUrl(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
  return `${baseUrl}/country-flags/${COUNTRY_FLAG_CATALOG_VERSION}/manifest.json`;
}

export const bnetLeagueCatalogVersion = 'v1';

/** Original Battle.net badge for a provider-reported division, never a W3C league ID. */
export function bnetLeagueIconUrl(division, options = {}) {
  if (!Number.isInteger(division) || division < 0 || division > 7) return undefined;
  const variant = options.variant ?? 'simplified';
  if (variant !== 'standard' && variant !== 'simplified') throw new TypeError('Unknown Battle.net badge variant');
  const folder = division === 0 ? 'standard' : variant;
  const baseUrl = normalizeAssetBaseUrl(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
  return `${baseUrl}/wc3/bnet-leagues/${bnetLeagueCatalogVersion}/${folder}/${division}.png`;
}

export function bnetLeagueManifestUrl(options = {}) {
  const baseUrl = normalizeAssetBaseUrl(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
  return `${baseUrl}/wc3/bnet-leagues/${bnetLeagueCatalogVersion}/manifest.json`;
}
