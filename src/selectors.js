/** True while a match is starting or running. */
export function isActiveMatch(match) {
  return match?.status === 'starting' || match?.status === 'running';
}

/** The configured broadcaster. A missing identity stays explicit unless fallbackToFirst is requested. */
export function broadcasterPlayer(match, players, options = {}) {
  const broadcaster = players.find(player => String(player.id) === String(match?.broadcasterPlayerId));
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

/** Relationship to the configured broadcaster, independent of any application's color palette. */
export function playerRelationship(player, match, players) {
  const broadcaster = broadcasterPlayer(match, players);
  if (!player || !broadcaster) return 'unknown';
  if (String(player.id) === String(broadcaster.id)) return 'self';
  if (!Number.isFinite(player.team) || !Number.isFinite(broadcaster.team)) return 'unknown';
  return Number(player.team) === Number(broadcaster.team) ? 'ally' : 'opponent';
}

/** Read hero items without exposing the protocol's items/inventory compatibility alias. */
export function heroInventory(hero) {
  return hero?.items ?? hero?.inventory ?? [];
}

/** Remove a numeric BattleTag discriminator while preserving ordinary hash characters. */
export function battleTagName(name) {
  if (typeof name !== 'string') return name;
  return name.replace(/#\d+$/, '') || name;
}
