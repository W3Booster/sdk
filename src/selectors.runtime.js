export { hasCapability, isActiveMatch, isObserverOrReplayMatch } from './internal/domain.js';
import { createImmutableSelector } from './internal/immutable-selector.js';

/** @type {readonly string[]} */
const EMPTY_INVENTORY = Object.freeze([]);
const EMPTY_RESOURCES = Object.freeze({ gold: 0, lumber: 0, supply: 0, supplyCap: 0, workerSupply: 0 });

const selectHeadToHeadPair = createImmutableSelector(players => players.length === 2
  ? Object.freeze([players[0], players[1]])
  : null);

const selectGroupedPlayers = createImmutableSelector(players => {
  const teams = new Map();
  for (const player of players) {
    const team = Number.isFinite(player.team) ? Number(player.team) : null;
    if (!teams.has(team)) teams.set(team, []);
    teams.get(team).push(player);
  }
  return Object.freeze([...teams].map(([teamId, teamPlayers]) => Object.freeze({
    teamId,
    players: Object.freeze(teamPlayers)
  })));
});

const selectBroadcasterFirstTeams = createImmutableSelector((players, broadcasterId, reverse) => {
  const teams = [...groupPlayersByTeam(players)];
  const broadcaster = broadcasterId
    ? players.find(player => String(player.id) === broadcasterId)
    : undefined;
  if (broadcaster) {
    const broadcasterTeam = Number.isFinite(broadcaster.team) ? Number(broadcaster.team) : null;
    teams.sort((left, right) =>
      Number(right.teamId === broadcasterTeam) - Number(left.teamId === broadcasterTeam));
  }
  if (reverse) teams.reverse();
  return Object.freeze(teams);
});

const selectCurrentUpgrades = createImmutableSelector((upgradesState, includeResearching) => {
  const upgrades = [...(upgradesState?.active ?? [])];
  if (includeResearching) {
    const identities = new Set(upgrades.map(upgradeIdentity));
    for (const upgrade of upgradesState?.researching ?? []) {
      const identity = upgradeIdentity(upgrade);
      if (identities.has(identity)) continue;
      identities.add(identity);
      upgrades.push(upgrade);
    }
  }
  return Object.freeze(upgrades);
});

const selectPlayerDisplayIdentity = createImmutableSelector((player, stripBattleTagDiscriminator) => {
  const rawInGameName = typeof player?.name === 'string' && player.name ? player.name : String(player?.id ?? '');
  const inGameName = stripBattleTagDiscriminator ? battleTagName(rawInGameName) : rawInGameName;
  const rawAccountName = typeof player?.mainAccount?.name === 'string' && player.mainAccount.name
    ? player.mainAccount.name
    : undefined;
  const accountName = stripBattleTagDiscriminator ? battleTagName(rawAccountName) : rawAccountName;
  return Object.freeze({
    primaryName: accountName ?? inGameName,
    inGameName,
    accountName,
    hasAlias: Boolean(accountName && inGameName && accountName !== inGameName)
  });
});

/** The configured broadcaster. A missing identity stays explicit unless fallbackToFirst is requested. */
export function broadcasterPlayer(match, players, options = {}) {
  const broadcasterId = match?.broadcasterPlayerId;
  const broadcaster = typeof broadcasterId === 'string' && broadcasterId.length > 0
    ? players.find(player => String(player.id) === broadcasterId)
    : undefined;
  return broadcaster ?? (options.fallbackToFirst ? players[0] : undefined) ?? null;
}

/** Return the complete two-player tuple required by head-to-head presentation, or null while scoped data is incomplete. */
export function headToHeadPair(players) {
  return selectHeadToHeadPair(players);
}

/** Group players by their protocol team id while preserving input order. */
export function groupPlayersByTeam(players) {
  return selectGroupedPlayers(players);
}

/** Group teams and place the configured broadcaster's team first. */
export function broadcasterFirstTeams(players, match, options = {}) {
  const broadcasterId = typeof match?.broadcasterPlayerId === 'string' ? match.broadcasterPlayerId : '';
  return selectBroadcasterFirstTeams(players, broadcasterId, options.reverse === true);
}

/** Relationship to the configured broadcaster, independent of any application's color palette. */
export function playerRelationship(player, match, players) {
  const broadcaster = broadcasterPlayer(match, players);
  if (!player || !broadcaster) return 'unknown';
  if (String(player.id) === String(broadcaster.id)) return 'self';
  if (!Number.isFinite(player.team) || !Number.isFinite(broadcaster.team)) return 'unknown';
  return Number(player.team) === Number(broadcaster.team) ? 'ally' : 'opponent';
}

/** Resolve protocol account and in-game names without choosing localized display copy. */
export function playerDisplayIdentity(player, options = {}) {
  return selectPlayerDisplayIdentity(player, options.stripBattleTagDiscriminator === true);
}

/** Read a hero's item-slot inventory. */
export function heroInventory(hero) {
  return hero?.inventory ?? EMPTY_INVENTORY;
}

const visibleUnits = (values, includeIllusions) => Object.freeze(
  Object.values(values || {}).filter(unit => includeIllusions || unit.isIllusion !== true)
    // IDs are fixed-width lowercase hex. Compare the full strings without losing
    // 64-bit precision or depending on the browser's locale. This is not spawn order.
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const selectHeroValues = createImmutableSelector(visibleUnits);
const selectUnitValues = createImmutableSelector(visibleUnits);
const selectBuildingValues = createImmutableSelector(visibleUnits);
/** Real units by default; opt in to include illusion instances. */
export function playerUnits(player, options = {}) { return selectUnitValues(player?.units, options.includeIllusions === true); }
export function playerBuildings(player, options = {}) { return selectBuildingValues(player?.buildings, options.includeIllusions === true); }
/** Heroes in ascending instance-ID order, excluding illusions unless explicitly requested. */
export function playerHeroes(player, options = {}) {
  return selectHeroValues(player?.heroes, options.includeIllusions === true);
}

/** Read player resources without collapsing unavailable scoped data into zeroes. */
export function playerResources(player) {
  return player?.resources;
}

/** Read player resources with an explicit stable zero-valued presentation fallback. */
export function playerResourcesOrZero(player) {
  return playerResources(player) ?? EMPTY_RESOURCES;
}

const EMPTY_GAME_CONTEXT = Object.freeze({ hudScale: 1 });
/** Read shared game context; no scope or capability check is needed. */
export function gameContext(state) {
  return state?.gameContext ?? EMPTY_GAME_CONTEXT;
}

/** Stable identity for one rendered inventory slot and its current contents. */
export function inventorySlotIdentity(index, item) {
  const slot = Number(index);
  if (!Number.isSafeInteger(slot) || slot < 0) throw new TypeError('inventory slot index must be a non-negative integer');
  return `${slot}:${String(item ?? '')}`;
}

/** Stable identity for one upgrade level. */
export function upgradeIdentity(upgrade) {
  if (!upgrade || typeof upgrade.typeId !== 'string' || !upgrade.typeId || !Number.isFinite(upgrade.level)) {
    throw new TypeError('upgrade must contain a name and finite level');
  }
  return `${upgrade.typeId}:${upgrade.level}`;
}

/**
 * Merge active and researching upgrades without returning the same rawcode and
 * level twice. Some producers include a researching upgrade in both lists.
 */
export function currentUpgrades(player, options = {}) {
  return selectCurrentUpgrades(player?.upgrades, options.includeResearching !== false);
}

/** Remove a numeric BattleTag discriminator while preserving ordinary hash characters. */
export function battleTagName(name) {
  if (typeof name !== 'string') return name;
  return name.replace(/#\d+$/, '') || name;
}
