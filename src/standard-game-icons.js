import { normalizeAssetBaseUrl } from './assets.js';
import { icons } from './standard-game-icon-data.js';

const DEFAULT_ASSET_BASE_URL = 'https://static.w3booster.com/assets';
const ASSET_CATALOG_VERSION = 'v1';

Object.freeze(icons);

export const assetBaseUrl = DEFAULT_ASSET_BASE_URL;
export const assetCatalogVersion = ASSET_CATALOG_VERSION;

export function getIcon(rawcode) {
  const candidate = typeof rawcode === 'string' && rawcode.length > 4 && /^\d+$/.test(rawcode.slice(4))
    ? rawcode.slice(0, 4)
    : rawcode;
  return Object.prototype.hasOwnProperty.call(icons, rawcode) ? icons[rawcode] : icons[candidate];
}

/** Resolve a rawcode or icon filename to one safe catalog filename. */
export function iconFileName(identifier) {
  if (typeof identifier !== 'string') return undefined;
  const mapped = getIcon(identifier);
  const candidate = (mapped ?? identifier).trim().toLowerCase();
  const filename = candidate.endsWith('.png') ? candidate : `${candidate}.png`;
  return filename && !filename.includes('/') && !filename.includes('\\') && filename !== '.png'
    ? filename
    : undefined;
}

/** Stable URL for a standard-game icon. The base URL can be replaced for local/offline hosting. */
export function iconUrl(identifier, options = {}) {
  const filename = iconFileName(identifier);
  if (!filename) return undefined;
  const graphics = options.graphics === 'classic' ? 'classic' : 'reforged';
  const baseUrl = normalizeAssetBaseUrl(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
  return `${baseUrl}/wc3/standard-game/${ASSET_CATALOG_VERSION}/${graphics}/icons/${encodeURIComponent(filename)}`;
}

export function heroIconUrl(hero, options = {}) { return iconUrl(hero?.id, options); }
export function abilityIconUrl(ability, options = {}) { return iconUrl(ability?.name, options); }
export function upgradeIconUrl(upgrade, options = {}) { return iconUrl(upgrade?.name, options); }
export function itemIconUrl(rawcode, options = {}) { return iconUrl(rawcode, options); }

export function assetManifestUrl(options = {}) {
  const baseUrl = normalizeAssetBaseUrl(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
  return `${baseUrl}/wc3/standard-game/${ASSET_CATALOG_VERSION}/manifest.json`;
}

/** Bind a hosted catalog once and derive Classic/Reforged URLs directly from match state. */
export function createAssetResolver(options = {}) {
  const baseUrl = normalizeAssetBaseUrl(options.baseUrl ?? DEFAULT_ASSET_BASE_URL);
  const urlOptions = match => ({
    baseUrl,
    graphics: match?.isReforged === false ? 'classic' : 'reforged'
  });
  return Object.freeze({
    icon: (match, identifier) => iconUrl(identifier, urlOptions(match)),
    hero: (match, hero) => heroIconUrl(hero, urlOptions(match)),
    ability: (match, ability) => abilityIconUrl(ability, urlOptions(match)),
    upgrade: (match, upgrade) => upgradeIconUrl(upgrade, urlOptions(match)),
    item: (match, rawcode) => itemIconUrl(rawcode, urlOptions(match))
  });
}
