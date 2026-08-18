import { normalizeAssetBaseUrl } from './assets.js';
import { finiteNonNegative } from './internal/numbers.js';
import { normalizeUpgradeRawcode } from './standard-game.js';
import { objects } from './standard-game-data.js';

const DEFAULT_ASSET_BASE_URL = 'https://static.w3booster.com/assets';
const ASSET_CATALOG_VERSION = 'v1';

for (const metadata of Object.values(objects)) Object.freeze(metadata);
Object.freeze(objects);

/** Shipped Warcraft III object metadata keyed by four-character rawcode. */
export { objects };
export const assetBaseUrl = DEFAULT_ASSET_BASE_URL;
export const assetCatalogVersion = ASSET_CATALOG_VERSION;

export function getObject(rawcode) {
  return Object.prototype.hasOwnProperty.call(objects, rawcode) ? objects[rawcode] : undefined;
}

export function getIcon(rawcode) {
  return (getObject(rawcode) ?? getObject(normalizeUpgradeRawcode(rawcode)))?.icon;
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

/** Resolve the canonical standard-game icon for a hydrated hero. */
export function heroIconUrl(hero, options = {}) {
  return iconUrl(hero?.id, options);
}

/** Resolve the canonical standard-game icon for a hydrated hero ability. */
export function abilityIconUrl(ability, options = {}) {
  return iconUrl(ability?.name, options);
}

/** Resolve the canonical standard-game icon for an upgrade. */
export function upgradeIconUrl(upgrade, options = {}) {
  return iconUrl(upgrade?.name, options);
}

/** Resolve the canonical standard-game icon for an inventory rawcode. */
export function itemIconUrl(rawcode, options = {}) {
  return iconUrl(rawcode, options);
}

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

export function getAbilityCooldown(rawcode, level = 1) {
  return numberField(rawcode, `Cool${Math.max(1, Math.trunc(level) || 1)}`);
}

export function numberField(rawcode, field) {
  const value = Number(getObject(rawcode)?.[field]);
  return Number.isFinite(value) ? value : undefined;
}

/** Derive a standard-game cooldown without exposing transport timestamp units. */
export function abilityCooldown(ability, gameTime) {
  const total = getAbilityCooldown(ability?.name, ability?.level);
  const activation = Number(ability?.lastActivation);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(activation) || activation <= 0) return undefined;
  const elapsed = Math.max(0, finiteNonNegative(gameTime) - Math.ceil(activation / 1000));
  const remaining = Math.max(0, total - elapsed);
  return { total, elapsed, remaining, progress: Math.min(1, elapsed / total), active: remaining > 0 };
}

/** Index active and completed standard-game ability cooldowns by their hydrated ability objects. */
export function abilityCooldownsForState(state) {
  const cooldowns = new Map();
  if (!state?.match?.gameTime || state.match.status === 'none' || state.match.status === 'finished') return cooldowns;
  for (const player of state.players || []) {
    for (const hero of player.heroes || []) {
      for (const ability of hero.abilities || []) {
        if (!ability.lastActivation || ability.lastActivation <= 0) continue;
        const cooldown = abilityCooldown(ability, state.match.gameTime);
        if (cooldown) cooldowns.set(ability, cooldown);
      }
    }
  }
  return cooldowns;
}
