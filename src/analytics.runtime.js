import { deepFreeze } from './internal/values.js';
import { validPlayerStatistics, validPlayerLosses } from './internal/analytics-state.js';

const KINDS = /** @type {const} */ (['unit-lost', 'building-lost', 'item-used', 'item-sold']);
const lanes = { 'unit-lost': 'units', 'building-lost': 'buildings', 'item-used': 'items', 'item-sold': 'items' };

/** @param {import('./analytics-contracts.js').MatchHistoryOptions} [options]
 * @returns {import('./analytics-contracts.js').MatchHistory} */
export function createMatchHistory(options = {}) {
  const maxSeconds = limit(options.maxSeconds, 7200, 86400);
  const maxSamples = limit(options.maxSamples, 15000, 100000);
  const maxEvents = limit(options.maxEvents, 20000, 100000);
  let signature = '', gameDataId, time = 0, retentionStart = 0;
  /** @type {import('./analytics-contracts.js').LossEvent[]} */
  let events = [];
  /** @type {Map<string, { economy: import('./analytics-contracts.js').EconomySample[], baselines: Map<string, any>, since: Map<string, number>, through: Map<string, number>, complete: boolean }>} */
  const players = new Map();
  function reset() { signature = ''; gameDataId = undefined; time = 0; retentionStart = 0; events = []; players.clear(); }
  function push(state) {
    const match = state.match;
    const mode = match.isObserver === true || match.isReplay === true;
    const nextSignature = `${match.id}|${match.isObserver}|${match.isReplay}|${match.realBroadcasterPlayerId}|${[...state.capabilities].sort().join(',')}`;
    if (!match.id || match.status === 'none') { reset(); return; }
    if (signature !== nextSignature || match.gameTime < time || match.gameDataId !== gameDataId) reset();
    signature = nextSignature; gameDataId = match.gameDataId; time = match.gameTime;
    retentionStart = Math.max(retentionStart, time - maxSeconds);
    const visible = state.players.filter(player => mode || player.id === match.realBroadcasterPlayerId);
    const present = new Set(visible.map(player => player.id));
    for (const id of players.keys()) if (!present.has(id)) { players.delete(id); events = events.filter(event => event.playerId !== id); }
    for (const player of visible) {
      let p = players.get(player.id);
      if (!p) { p = { economy: [], baselines: new Map(), since: new Map(), through: new Map(), complete: false }; players.set(player.id, p); }
      const stats = validPlayerStatistics(player.statistics) ? player.statistics : undefined;
      const losses = validPlayerLosses(player.losses) ? player.losses : undefined;
      p.complete = losses?.complete === true;
      // Scope checks also protect callers feeding snapshots directly to the helper.
      const items = state.capabilities.includes('heroes') ? stats?.items : undefined;
      const units = state.capabilities.includes('units') ? losses?.units : undefined;
      const buildings = state.capabilities.includes('buildings') ? losses?.buildings : undefined;
      observe(player.id, p, 'items', items, stats?.gameTime);
      observe(player.id, p, 'units', units, losses?.gameTime);
      observe(player.id, p, 'buildings', buildings, losses?.gameTime);
      if (state.capabilities.includes('resources') && stats?.goldMined !== undefined && stats.goldUpkeepLost !== undefined && Math.abs(time - stats.gameTime) <= 5) {
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
  function observe(playerId, p, lane, counters, at) {
    const old = p.baselines.get(lane);
    // A withdrawn/stale feed starts a new interval, rather than backfilling an outage.
    if (!counters || !Number.isFinite(at) || Math.abs(time - at) > 5) { p.baselines.delete(lane); p.since.delete(lane); p.through.delete(lane); return; }
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
