export { hasCapability, isActiveMatch, isObserverOrReplayMatch } from './internal/domain.js';

const EMPTY_OVERLAY_RUNTIME = Object.freeze({});
const EMPTY_INVENTORY = Object.freeze([]);
const EMPTY_HEROES = Object.freeze([]);
const EMPTY_RESOURCES = Object.freeze({ gold: 0, lumber: 0, supply: 0, supplyCap: 0, workerSupply: 0 });
const EMPTY_MATCH_SCORE = Object.freeze({ wins: 0, losses: 0 });

/** The configured broadcaster. A missing identity stays explicit unless fallbackToFirst is requested. */
export function broadcasterPlayer(match, players, options = {}) {
  const broadcasterId = match?.broadcasterPlayerId;
  const broadcaster = typeof broadcasterId === 'string' && broadcasterId.length > 0
    ? players.find(player => String(player.id) === broadcasterId)
    : undefined;
  return broadcaster ?? (options.fallbackToFirst ? players[0] : undefined) ?? null;
}

/** Group players by their protocol team id while preserving input order. */
export function groupPlayersByTeam(players) {
  const teams = new Map();
  for (const player of players) {
    const team = Number.isFinite(player.team) ? Number(player.team) : null;
    if (!teams.has(team)) teams.set(team, []);
    teams.get(team).push(player);
  }
  return [...teams].map(([teamId, teamPlayers]) => ({ teamId, players: teamPlayers }));
}

/** Group teams and place the configured broadcaster's team first. */
export function broadcasterFirstTeams(players, match, options = {}) {
  const teams = groupPlayersByTeam(players);
  const broadcaster = broadcasterPlayer(match, players);
  if (broadcaster) {
    teams.sort((left, right) =>
      Number(right.teamId === broadcaster.team) - Number(left.teamId === broadcaster.team));
  }
  if (options.reverse === true) teams.reverse();
  return teams;
}

/** Relationship to the configured broadcaster, independent of any application's color palette. */
export function playerRelationship(player, match, players) {
  const broadcaster = broadcasterPlayer(match, players);
  if (!player || !broadcaster) return 'unknown';
  if (String(player.id) === String(broadcaster.id)) return 'self';
  if (!Number.isFinite(player.team) || !Number.isFinite(broadcaster.team)) return 'unknown';
  return Number(player.team) === Number(broadcaster.team) ? 'ally' : 'opponent';
}

/** Read a hero's item-slot inventory. */
export function heroInventory(hero) {
  return hero?.inventory ?? EMPTY_INVENTORY;
}

/** Read a player's heroes through one stable empty fallback. */
export function playerHeroes(player) {
  return player?.heroes ?? EMPTY_HEROES;
}

/** Read normalized player resources through one stable zero-valued fallback. */
export function playerResources(player) {
  return player?.resources ?? EMPTY_RESOURCES;
}

/** Read public overlay runtime values through one stable empty fallback. */
export function overlayRuntime(state) {
  return state?.overlay?.runtime ?? EMPTY_OVERLAY_RUNTIME;
}

/** Read the normalized match score through one stable zero-valued fallback. */
export function matchScore(state) {
  return state?.overlay?.runtime?.matchScore ?? EMPTY_MATCH_SCORE;
}

/** Stable identity for one rendered inventory slot and its current contents. */
export function inventorySlotIdentity(index, item) {
  const slot = Number(index);
  if (!Number.isSafeInteger(slot) || slot < 0) throw new TypeError('inventory slot index must be a non-negative integer');
  return `${slot}:${String(item ?? '')}`;
}

/** Stable identity for one upgrade level. */
export function upgradeIdentity(upgrade) {
  if (!upgrade || typeof upgrade.name !== 'string' || !upgrade.name || !Number.isFinite(upgrade.level)) {
    throw new TypeError('upgrade must contain a name and finite level');
  }
  return `${upgrade.name}:${upgrade.level}`;
}

/**
 * Merge active and researching upgrades without returning the same rawcode and
 * level twice. Some producers include a researching upgrade in both lists.
 */
export function currentUpgrades(player, options = {}) {
  const upgrades = [...(player?.upgrades?.active ?? [])];
  if (options.includeResearching === false) return upgrades;
  const identities = new Set(upgrades.map(upgradeIdentity));
  for (const upgrade of player?.upgrades?.researching ?? []) {
    const identity = upgradeIdentity(upgrade);
    if (identities.has(identity)) continue;
    identities.add(identity);
    upgrades.push(upgrade);
  }
  return upgrades;
}

/** Remove a numeric BattleTag discriminator while preserving ordinary hash characters. */
export function battleTagName(name) {
  if (typeof name !== 'string') return name;
  return name.replace(/#\d+$/, '') || name;
}
