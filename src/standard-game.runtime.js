import { finiteNonNegative } from './internal/numbers.js';
import { createImmutableSelector } from './internal/immutable-selector.js';
import { broadcasterFirstTeams, groupPlayersByTeam, isObserverOrReplayMatch, playerRelationship } from './selectors.js';

const RACES = Object.freeze({
  random: Object.freeze({ localizationKey: 'race.random', shortLocalizationKey: 'race.random.short' }),
  human: Object.freeze({ localizationKey: 'race.human', shortLocalizationKey: 'race.human.short' }),
  orc: Object.freeze({ localizationKey: 'race.orc', shortLocalizationKey: 'race.orc.short' }),
  undead: Object.freeze({ localizationKey: 'race.undead', shortLocalizationKey: 'race.undead.short' }),
  'night-elf': Object.freeze({ localizationKey: 'race.night-elf', shortLocalizationKey: 'race.night-elf.short' })
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
const selectHeadToHeadPlayers = createImmutableSelector((players, reverse) => {
  const ordered = [...players];
  if (ordered.length === 2) {
    const left = Number(ordered[0]?.startPosition?.x);
    const right = Number(ordered[1]?.startPosition?.x);
    if (Number.isFinite(left) && Number.isFinite(right) && left > right) ordered.reverse();
  }
  if (reverse) ordered.reverse();
  return Object.freeze(ordered);
});
const selectMatchTeams = createImmutableSelector((players, observerOrReplay, broadcasterPlayerId, reverse) => {
  const teams = groupPlayersByTeam(players);
  if (!observerOrReplay) return teams;
  if (teams.length !== 2) return reverse ? Object.freeze([...teams].reverse()) : teams;
  const playerCount = teams.reduce((count, team) => count + team.players.length, 0);
  if (playerCount === 2) {
    const ordered = orderHeadToHeadPlayers(teams.map(team => team.players[0]), { reverse });
    const orderedTeams = ordered.map(player => teams.find(team =>
      /** @type {any} */ (team.players[0])?.id === player?.id));
    return orderedTeams.every(Boolean) ? Object.freeze(orderedTeams) : teams;
  }
  return broadcasterFirstTeams(players, { broadcasterPlayerId }, { reverse });
});
const MELEE_MODES = Object.freeze({
  '1v1': Object.freeze({ id: '1v1', kind: 'head-to-head', playerCount: 2, teamSize: 1, stats: 'solo' }),
  '2v2': Object.freeze({ id: '2v2', kind: 'team', playerCount: 4, teamSize: 2, stats: 'team' }),
  '3v3': Object.freeze({ id: '3v3', kind: 'team', playerCount: 6, teamSize: 3, stats: 'team' }),
  '4v4': Object.freeze({ id: '4v4', kind: 'team', playerCount: 8, teamSize: 4, stats: 'team4' }),
  '3ffa': Object.freeze({ id: '3ffa', kind: 'ffa', playerCount: 3, teamSize: 1, stats: 'ffa' }),
  '4ffa': Object.freeze({ id: '4ffa', kind: 'ffa', playerCount: 4, teamSize: 1, stats: 'ffa' })
});

export const races = RACES;
export const playerColors = PLAYER_COLORS;
export const weaponOrArmorUpgradeRawcodes = WEAPON_OR_ARMOR_UPGRADE_RAWCODES;
export const meleeModes = MELEE_MODES;

/** Resolve locale-neutral metadata without choosing application display copy. */
export function raceInfo(race) {
  const normalized = String(race || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return RACES[normalized] || RACES.random;
}

export function normalizeMode(mode) {
  if (!mode || mode === 'undefined') return 'undefined';
  return mode.startsWith('gm-') ? mode : `gm-${mode}`;
}

export function isMode(mode, expected) {
  return normalizeMode(mode) === normalizeMode(expected);
}

/** Semantic information for supported standard melee modes. */
export function modeInfo(mode) {
  const id = normalizeMode(mode).replace(/^gm-/, '');
  return MELEE_MODES[id];
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
  const stats = modeInfo(mode)?.stats;
  return stats ? player?.stats?.[stats] : player?.stats?.solo;
}

/** Select mode-specific statistics, then the first available standard ladder record. */
export function preferredStats(player, mode) {
  return statsForMode(player, mode)
    ?? player?.stats?.solo
    ?? player?.stats?.team
    ?? player?.stats?.team4
    ?? player?.stats?.ffa;
}

/** Format elapsed in-game seconds as m:ss or h:mm:ss. */
export function formatGameTime(gameTime, options = {}) {
  const total = Math.floor(finiteNonNegative(gameTime));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const compactHours = options.compactHours === true;
  const minuteText = String(minutes).padStart(hours || !compactHours ? 2 : 1, '0');
  const tail = `${minuteText}:${String(total % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${tail}` : tail;
}

/** Warcraft III's standard 8-minute day/night clock. */
export function dayNightState(gameTime) {
  const seconds = finiteNonNegative(gameTime);
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

/** Normalize a current/max pool to a frontend-safe ratio. */
export function valuePoolRatio(pool, options = {}) {
  const current = Number(pool?.current);
  const maximum = Number(pool?.max);
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  const ratio = current / maximum;
  return options.clamp === false ? ratio : Math.max(0, Math.min(1, ratio));
}

export function isValuePoolDepleted(pool) {
  return Number.isFinite(Number(pool?.current)) && Number(pool.current) <= 0;
}

/** Classify standard Warcraft III upkeep from normalized supply. */
export function upkeepState(supply) {
  if (supply === null || supply === undefined) return undefined;
  const value = Number(supply);
  if (!Number.isFinite(value) || value < 0) return undefined;
  if (value <= 50) return 'none';
  if (value <= 80) return 'low';
  return 'high';
}

/** Order a two-player standard-game presentation by known map start positions. */
export function orderHeadToHeadPlayers(players, options = {}) {
  return selectHeadToHeadPlayers(players, options.reverse === true);
}

/** Apply W3Booster's canonical observer/replay team presentation order. */
export function orderMatchTeams(players, match, options = {}) {
  return selectMatchTeams(
    players,
    isObserverOrReplayMatch(match),
    typeof match?.broadcasterPlayerId === 'string' ? match.broadcasterPlayerId : '',
    options.reverse === true
  );
}

/** Resolve native or simplified W3Booster team colors for one player. */
export function presentationPlayerColor(player, match, players, runtime = {}) {
  if (runtime.teamColors !== true) return playerColor(player?.colorId);
  const relationship = playerRelationship(player, match, players);
  if (relationship === 'unknown') return playerColor(player?.colorId);
  if (match?.isObserver === true && relationship === 'self') return PLAYER_COLORS[2];
  if (relationship === 'self') return PLAYER_COLORS[1];
  if (relationship === 'ally') return PLAYER_COLORS[2];
  return PLAYER_COLORS[0];
}

/** Format the standard-game level plus progress within the current hero level. */
export function formatHeroLevelProgress(hero) {
  if (typeof hero?.experience !== 'number') return String(hero?.level ?? 1);
  const experience = heroExperienceState(hero.experience);
  if (experience.level >= HERO_MAX_LEVEL) return String(HERO_MAX_LEVEL);
  const displayLevel = experience.level + experience.progress;
  return (Math.trunc(displayLevel * 10) / 10).toFixed(1);
}

function heroExperienceForLevel(level) {
  const normalized = Math.max(1, Math.min(HERO_MAX_LEVEL, Math.trunc(level) || 1));
  return (normalized - 1) * (normalized + 2) * 50;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
