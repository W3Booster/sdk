import { deepFreeze } from './internal/values.js';
import { validPlayerStatistics, validPlayerLosses } from './internal/analytics-state.js';

const KINDS = /** @type {const} */ (['unit-lost', 'building-lost', 'hero-lost', 'item-used', 'item-sold']);
const lanes = { 'unit-lost': 'units', 'building-lost': 'buildings', 'hero-lost': 'heroes', 'item-used': 'items', 'item-sold': 'items' };

/** @param {import('./analytics-contracts.js').MatchHistoryOptions} [options]
 * @returns {import('./analytics-contracts.js').MatchHistory} */
export function createMatchHistory(options = {}) {
  const maxSeconds = limit(options.maxSeconds, 7200, 86400);
  const maxSamples = limit(options.maxSamples, 15000, 100000);
  const maxEvents = limit(options.maxEvents, 20000, 100000);
  const now = options.now ?? (() => performance.now());
  if (typeof now !== 'function') throw new TypeError('History now must be a monotonic clock function.');
  let signature = '', gameDataId, time = 0, retentionStart = 0;
  let lastWall = /** @type {number|null} */ (null), activeTime = 0, advancing = false;
  /** @type {{ at: number, speed: number }[]} */
  let recentSpeeds = [];
  /** @type {import('./analytics-contracts.js').LossEvent[]} */
  let events = [];
  /** @type {Map<string, { economy: import('./analytics-contracts.js').EconomySample[], baselines: Map<string, any>, since: Map<string, number>, through: Map<string, number>, feeds: Map<string, { at: number, received: number, speed: number, stale: boolean }>, complete: boolean }>} */
  const players = new Map();
  function reset() { signature = ''; gameDataId = undefined; time = 0; retentionStart = 0; events = []; players.clear(); lastWall = null; activeTime = 0; advancing = false; recentSpeeds = []; }
  function push(state) {
    const match = state.match;
    const mode = match.isObserver === true || match.isReplay === true;
    const nextSignature = `${match.id}|${match.isObserver}|${match.isReplay}|${match.realBroadcasterPlayerId}|${[...state.capabilities].sort().join(',')}`;
    if (!match.id || match.status === 'none') { reset(); return; }
    if (signature !== nextSignature || match.gameTime < time || match.gameDataId !== gameDataId) reset();
    const wall = now();
    if (!Number.isFinite(wall) || lastWall !== null && wall < lastWall) throw new RangeError('History clock must return finite monotonic milliseconds.');
    if (lastWall !== null && advancing) activeTime += wall - lastWall;
    lastWall = wall; advancing = !match.paused && ['running', 'starting'].includes(match.status);
    const speed = match.isReplay === true && Number.isFinite(match.gameSpeed) && match.gameSpeed >= 0 && match.gameSpeed <= 64 ? Math.max(1, match.gameSpeed) : 1;
    // Native rate observations can briefly report zero during fast playback.
    // Keep a bounded one-second transition allowance, not a match-long maximum.
    while (recentSpeeds.length && recentSpeeds[0].at < activeTime - 1000) recentSpeeds.shift();
    while (recentSpeeds.length && recentSpeeds[recentSpeeds.length - 1].speed <= speed) recentSpeeds.pop();
    recentSpeeds.push({ at: activeTime, speed });
    const recentSpeed = recentSpeeds[0].speed;
    signature = nextSignature; gameDataId = match.gameDataId; time = match.gameTime;
    retentionStart = Math.max(retentionStart, time - maxSeconds);
    const visible = state.players.filter(player => mode || player.id === match.realBroadcasterPlayerId);
    const present = new Set(visible.map(player => player.id));
    for (const id of players.keys()) if (!present.has(id)) { players.delete(id); events = events.filter(event => event.playerId !== id); }
    for (const player of visible) {
      let p = players.get(player.id);
      if (!p) { p = { economy: [], baselines: new Map(), since: new Map(), through: new Map(), feeds: new Map(), complete: false }; players.set(player.id, p); }
      const stats = validPlayerStatistics(player.statistics) ? player.statistics : undefined;
      const losses = validPlayerLosses(player.losses) ? player.losses : undefined;
      p.complete = losses?.complete === true;
      const statsFresh = fresh(p, 'statistics', stats?.gameTime, recentSpeed);
      const lossesFresh = fresh(p, 'losses', losses?.gameTime, recentSpeed);
      // Scope checks also protect callers feeding snapshots directly to the helper.
      const items = state.capabilities.includes('heroes') ? stats?.items : undefined;
      const units = state.capabilities.includes('units') ? losses?.units : undefined;
      const buildings = state.capabilities.includes('buildings') ? losses?.buildings : undefined;
      observe(player.id, p, 'items', statsFresh ? items : undefined, stats?.gameTime);
      observe(player.id, p, 'units', lossesFresh ? units : undefined, losses?.gameTime);
      observe(player.id, p, 'buildings', lossesFresh ? buildings : undefined, losses?.gameTime);
      observeHeroes(player.id, p, statsFresh && state.capabilities.includes('heroes') ? stats?.heroes : undefined, stats?.gameTime);
      if (state.capabilities.includes('resources') && stats?.goldMined !== undefined && stats.goldUpkeepLost !== undefined && statsFresh) {
        const last = p.economy[p.economy.length - 1];
        if (last && (stats.gameTime < last.gameTime || stats.goldMined < last.goldMined || stats.goldUpkeepLost < last.goldUpkeepLost)) p.economy = [];
        const sample = Object.freeze({ gameTime: stats.gameTime, goldMined: stats.goldMined, goldUpkeepLost: stats.goldUpkeepLost, netGold: stats.goldMined - stats.goldUpkeepLost });
        if (p.economy.length && p.economy[p.economy.length - 1].gameTime === sample.gameTime) p.economy[p.economy.length - 1] = sample;
        else p.economy.push(sample);
        p.economy = p.economy.filter(sample => sample.gameTime >= retentionStart).slice(-maxSamples);
      } else p.economy = [];
    }
    events = events.filter(event => event.gameTime >= retentionStart);
    if (events.length > maxEvents) { retentionStart = Math.max(retentionStart, events[events.length-maxEvents-1].gameTime); events = events.slice(-maxEvents); }
  }
  function fresh(p, lane, at, speed) {
    if (!Number.isFinite(at)) { p.feeds.delete(lane); return false; }
    let feed = p.feeds.get(lane);
    if (feed && activeTime - feed.received > 5000) {
      // A new sample after a delivery gap must not bridge that gap, even when
      // the caller received no intermediate snapshots showing the stale feed.
      if (lane === 'statistics') p.economy = [];
      for (const name of lane === 'statistics' ? ['items', 'heroes'] : ['units', 'buildings']) {
        p.baselines.delete(name); p.since.delete(name); p.through.delete(name);
      }
    }
    if (!feed || at !== feed.at) {
      feed = { at, received: activeTime, speed, stale: false }; p.feeds.set(lane, feed);
    } else feed.speed = Math.max(feed.speed, speed);
    // Carry the speed of this observation until its next sample, so deceleration
    // does not invalidate healthy data sampled at the previous faster cadence.
    // Real-time expiry prevents that carry from preserving a frozen feed forever.
    feed.stale ||= activeTime - feed.received > 5000 || Math.abs(time - at) > 5 * feed.speed;
    return !feed.stale;
  }
  function observeHeroes(playerId, p, heroes, at) {
    const lane = 'heroes';
    const old = p.baselines.get(lane);
    if (!heroes) {
      p.baselines.delete(lane); p.since.delete(lane); p.through.delete(lane); return;
    }
    const rollback = old && at < old.time;
    if (rollback) events = events.filter(event => event.playerId !== playerId || event.kind !== 'hero-lost');
    if (!old || rollback) p.since.set(lane, at);
    // An absent instance is unavailable, not dead. Returning/transferred heroes
    // establish a fresh baseline even if their lifetime counter is already nonzero.
    if (old && Object.keys(old.counters).some(id => !heroes[id])) p.since.set(lane, at);
    const counters = {};
    for (const [heroId, hero] of Object.entries(/** @type {Record<string, import('./contracts.js').HeroStatistics>} */ (heroes))) {
      counters[heroId] = { typeId: hero.typeId, deaths: hero.deaths };
      const previous = !rollback && old?.counters[heroId];
      if (!previous) {
        if (hero.deaths > 0) p.since.set(lane, at);
        continue;
      }
      if (previous.typeId !== hero.typeId || hero.deaths < previous.deaths) {
        p.since.set(lane, at);
        events = events.filter(event => event.playerId !== playerId || event.heroId !== heroId);
        continue;
      }
      const delta = hero.deaths - previous.deaths;
      if (delta > 0) events.push(Object.freeze({ playerId, heroId, typeId: hero.typeId,
        kind: 'hero-lost', count: delta, fromGameTime: old.time, gameTime: at }));
    }
    p.baselines.set(lane, { time: at, counters }); p.through.set(lane, at);
  }
  function observe(playerId, p, lane, counters, at) {
    const old = p.baselines.get(lane);
    // A withdrawn/stale feed starts a new interval, rather than backfilling an outage.
    if (!counters) { p.baselines.delete(lane); p.since.delete(lane); p.through.delete(lane); return; }
    const flattened = {};
    if (lane === 'items') {
      for (const [typeId, item] of Object.entries(counters)) for (const action of ['used', 'sold']) flattened[`${typeId}:${action}`] = item[action];
    } else Object.assign(flattened, counters);
    const rollback = old && (at < old.time || Object.entries(old.counters).some(([key, count]) => (flattened[key] ?? 0) < Number(count)));
    if (rollback) {
      events = events.filter(event => event.playerId !== playerId || lanes[event.kind] !== lane);
      p.since.delete(lane);
    }
    if (!old || rollback) p.since.set(lane, at);
    else {
      for (const [key, count] of Object.entries(flattened)) {
        const delta = Number(count) - (old.counters[key] ?? 0);
        if (delta <= 0) continue;
        const [typeId, action] = key.split(':');
        const kind = lane === 'units' ? 'unit-lost' : lane === 'buildings' ? 'building-lost' : `item-${action}`;
        events.push(Object.freeze({ playerId, typeId, kind: /** @type {import('./analytics-contracts.js').LossKind} */ (kind), count: delta, fromGameTime: old.time, gameTime: at }));
      }
    }
    p.baselines.set(lane, { time: at, counters: flattened }); p.through.set(lane, at);
  }
  return Object.freeze({ push, reset,
    economy(playerId) { return Object.freeze([...(players.get(playerId)?.economy || [])]); },
    window(playerId, seconds, data, options = {}) {
      if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError('Window duration must be positive game seconds.');
      if (data && (!gameDataId || data.id !== gameDataId)) throw new RangeError('Use the match-advertised game data revision.');
      const kinds = options.kinds || KINDS;
      if (!Array.isArray(kinds) || kinds.some(kind => !KINDS.includes(kind))) throw new TypeError('Invalid loss kind.');
      const refund = options.soldItemRefundRate;
      if (refund !== undefined && (!Number.isFinite(refund) || refund < 0 || refund > 1)) throw new RangeError('Refund rate must be between 0 and 1.');
      const from = Math.max(0, time - seconds);
      const selected = events.filter(event => event.playerId === playerId && event.gameTime > from && event.gameTime <= time && kinds.includes(event.kind));
      const counts = Object.fromEntries(KINDS.map(kind => [kind, {}]));
      /** @type {{gold: number|null, lumber: number|null, food: number|null}} */
      const cost = { gold: 0, lumber: 0, food: 0 };
      for (const event of selected) {
        counts[event.kind][event.typeId] = (counts[event.kind][event.typeId] || 0) + event.count;
        // Hero deaths are timeline events, not measured recruitment/revival spend.
        if (event.kind === 'hero-lost') continue;
        const item = event.kind.startsWith('item-');
        const definition = item ? data?.items.get(event.typeId) : data?.units.get(event.typeId);
        let multiplier = event.count;
        if (event.kind === 'item-used') multiplier /= Math.max(1, /** @type {import('./game-data-contracts.js').ItemType|undefined} */ (definition)?.initialCharges || 1);
        if (event.kind === 'item-sold') multiplier *= refund === undefined ? NaN : 1 - refund;
        for (const key of /** @type {const} */ (['gold', 'lumber', 'food'])) {
          const amount = key === 'food' ? (item ? 0 : /** @type {import('./game-data-contracts.js').UnitType|undefined} */ (definition)?.supply.used) : definition?.cost[key];
          if (!Number.isFinite(amount) || !Number.isFinite(multiplier)) cost[key] = null;
          else if (cost[key] !== null) cost[key] += Number(amount) * multiplier;
        }
      }
      const p = players.get(playerId);
      const covered = from >= retentionStart && !!p && [...new Set(kinds.map(kind => lanes[kind]))].every(lane =>
        p.since.has(lane) && (p.since.get(lane) ?? Infinity) <= from && (p.through.get(lane) ?? -Infinity) >= time);
      return deepFreeze({ fromGameTime: from, toGameTime: time, events: selected, counts, cost, covered,
        complete: covered && (!kinds.some(kind => kind === 'unit-lost' || kind === 'building-lost') || p?.complete === true),
        boundaryUncertain: selected.some(event => event.fromGameTime < from) });
    }
  });
}
function limit(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) throw new RangeError(`History limit must be an integer between 1 and ${maximum}.`);
  return value;
}
