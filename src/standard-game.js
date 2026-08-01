import { objects } from './standard-game-data.js';

const RACES = Object.freeze({
  random: Object.freeze({ name: 'Random', shortName: 'RDM' }),
  human: Object.freeze({ name: 'Human', shortName: 'HU' }),
  orc: Object.freeze({ name: 'Orc', shortName: 'ORC' }),
  undead: Object.freeze({ name: 'Undead', shortName: 'UD' }),
  'night-elf': Object.freeze({ name: 'Night Elf', shortName: 'NE' })
});

const PLAYER_COLORS = Object.freeze([
  '#ff0303', '#0042ff', '#1ce6b9', '#540081', '#fffc00', '#fe8a0e',
  '#20c000', '#e55bb0', '#959697', '#7ebff1', '#106246', '#4e2a04',
  '#9b0000', '#0000c3', '#00eaff', '#be00fe', '#ebcd87', '#f8a48b',
  '#bfff80', '#dcb9eb', '#282828', '#ebf0ff', '#00781e', '#a46f33'
]);

const WEAPON_OR_ARMOR_UPGRADE_RAWCODES = Object.freeze([
  'Rema', 'Rerh', 'Resm', 'Resw',
  'Rhar', 'Rhla', 'Rhme', 'Rhra',
  'Roar', 'Rome', 'Rora',
  'Ruar', 'Rucr', 'Rume', 'Rura'
]);
const WEAPON_OR_ARMOR_UPGRADES = new Set(WEAPON_OR_ARMOR_UPGRADE_RAWCODES);
const DAY_NIGHT_CYCLE_SECONDS = 480;
const HERO_MAX_LEVEL = 10;
const DEFAULT_ASSET_BASE_URL = 'https://assets.w3booster.com';
const ASSET_CATALOG_VERSION = 'v1';

for (const metadata of Object.values(objects)) Object.freeze(metadata);
Object.freeze(objects);

/** Shipped Warcraft III object metadata keyed by four-character rawcode. */
export { objects };
export const races = RACES;
export const playerColors = PLAYER_COLORS;
export const weaponOrArmorUpgradeRawcodes = WEAPON_OR_ARMOR_UPGRADE_RAWCODES;
export const assetBaseUrl = DEFAULT_ASSET_BASE_URL;
export const assetCatalogVersion = ASSET_CATALOG_VERSION;

export function getObject(rawcode) {
  return Object.prototype.hasOwnProperty.call(objects, rawcode)
    ? objects[rawcode]
    : undefined;
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
  const baseUrl = String(options.baseUrl ?? DEFAULT_ASSET_BASE_URL).replace(/\/+$/, '');
  return `${baseUrl}/wc3/standard-game/${ASSET_CATALOG_VERSION}/${graphics}/icons/${encodeURIComponent(filename)}`;
}

export function assetManifestUrl(options = {}) {
  const baseUrl = String(options.baseUrl ?? DEFAULT_ASSET_BASE_URL).replace(/\/+$/, '');
  return `${baseUrl}/wc3/standard-game/${ASSET_CATALOG_VERSION}/manifest.json`;
}

export function getAbilityCooldown(rawcode, level = 1) {
  return numberField(rawcode, `Cool${Math.max(1, Math.trunc(level) || 1)}`);
}

export function numberField(rawcode, field) {
  const value = Number(getObject(rawcode)?.[field]);
  return Number.isFinite(value) ? value : undefined;
}

export function normalizeMode(mode) {
  if (!mode || mode === 'undefined') return 'undefined';
  return mode.startsWith('gm-') ? mode : `gm-${mode}`;
}

export function isMode(mode, expected) {
  return normalizeMode(mode) === normalizeMode(expected);
}

export function raceName(race = 'random') {
  return (RACES[race] || RACES.random).name;
}

export function raceShortName(race = 'random') {
  return (RACES[race] || RACES.random).shortName;
}

export function playerColor(colorId) {
  return PLAYER_COLORS[colorId] || '#959697';
}

/** Strip the synthetic level suffix used by W3Booster upgrade events. */
export function normalizeUpgradeRawcode(rawcode) {
  if (typeof rawcode !== 'string') return '';
  const candidate = rawcode.length > 4 && /^\d+$/.test(rawcode.slice(4)) ? rawcode.slice(0, 4) : rawcode;
  return candidate;
}

export function isWeaponOrArmorUpgrade(rawcode) {
  return WEAPON_OR_ARMOR_UPGRADES.has(normalizeUpgradeRawcode(rawcode));
}

/** Select the standard ladder statistics represented by a match mode. */
export function statsForMode(player, mode) {
  const normalized = normalizeMode(mode);
  if (normalized === 'gm-3ffa' || normalized === 'gm-4ffa') return player?.stats?.ffa;
  if (normalized === 'gm-4v4') return player?.stats?.team4;
  if (normalized === 'gm-2v2' || normalized === 'gm-3v3') return player?.stats?.team;
  return player?.stats?.solo;
}

/** Derive a standard-game cooldown without exposing transport timestamp units. */
export function abilityCooldown(ability, gameTime) {
  const total = getAbilityCooldown(ability?.name, ability?.level);
  const activation = Number(ability?.lastActivation);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(activation) || activation <= 0) return undefined;
  const elapsed = Math.max(0, finiteSeconds(gameTime) - Math.ceil(activation / 1000));
  const remaining = Math.max(0, total - elapsed);
  return {
    total,
    elapsed,
    remaining,
    progress: Math.min(1, elapsed / total),
    active: remaining > 0
  };
}

/** Warcraft III's standard 8-minute day/night clock. */
export function dayNightState(gameTime) {
  const seconds = finiteSeconds(gameTime);
  const secondsIntoCycle = positiveModulo(seconds, DAY_NIGHT_CYCLE_SECONDS);
  return {
    hour: positiveModulo(6 + secondsIntoCycle / 20, 24),
    isDay: secondsIntoCycle < DAY_NIGHT_CYCLE_SECONDS / 2,
    secondsIntoCycle,
    cycleProgress: secondsIntoCycle / DAY_NIGHT_CYCLE_SECONDS
  };
}

/** Level and progress derived from Warcraft III standard melee experience thresholds. */
export function heroExperienceState(experience = 0) {
  const totalExperience = Math.max(0, Number(experience) || 0);
  let level = 1;
  while (level < HERO_MAX_LEVEL && totalExperience >= heroExperienceForLevel(level + 1)) level += 1;
  const levelStartExperience = heroExperienceForLevel(level);
  const nextLevelExperience = level < HERO_MAX_LEVEL ? heroExperienceForLevel(level + 1) : undefined;
  const experienceIntoLevel = totalExperience - levelStartExperience;
  const experienceForNextLevel = nextLevelExperience === undefined
    ? 0
    : nextLevelExperience - levelStartExperience;
  return {
    level,
    experience: totalExperience,
    levelStartExperience,
    nextLevelExperience,
    experienceIntoLevel,
    experienceForNextLevel,
    progress: nextLevelExperience === undefined ? 1 : experienceIntoLevel / experienceForNextLevel
  };
}

function heroExperienceForLevel(level) {
  const normalized = Math.max(1, Math.min(HERO_MAX_LEVEL, Math.trunc(level) || 1));
  return (normalized - 1) * (normalized + 2) * 50;
}

function finiteSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
