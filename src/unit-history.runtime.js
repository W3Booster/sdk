import { deepFreeze } from './internal/values.js';
import { validPlayerStatistics } from './internal/analytics-state.js';
const COUNTERS = ['damageDealt', 'damageReceived', 'healingDone'];
const zero = () => ({ damageDealt: 0, damageReceived: 0, healingDone: 0 });
const bound = (value, fallback, maximum) => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid unit history limit.');
  return value;
};
/** @param {import('./analytics-contracts.js').UnitHistoryOptions} [options]
 * @returns {import('./analytics-contracts.js').UnitHistory} */
export function createUnitHistory(options = {}) {
  const maxUnits = bound(options.maxUnits, 8192, 100000);
  const maxEvents = bound(options.maxEvents, 20000, 100000);
  const maxSeconds = bound(options.maxSeconds, 7200, 86400);
  const now = options.now ?? (() => performance.now());
  if (typeof now !== 'function') throw new TypeError('History now must be a monotonic clock function.');
  /** @type {Map<string, any>} */
  const units = new Map();
  /** @type {Map<string, any>} */
  const feeds = new Map();
  /** @type {Map<string, any>} */
  const totals = new Map();
  /** @type {any[]} */
  let events = [];
  /** @type {any[]} */
  let intervals = [];
  /** @type {{at:number,speed:number}[]} */
  let recentSpeeds = [];
  let signature = '', time = 0, retentionStart = 0, truncated = false;
  let lastWall = /** @type {number|null} */ (null), activeTime = 0, advancing = false;
  function reset() {
    units.clear(); feeds.clear(); totals.clear(); events = []; intervals = [];
    signature = ''; time = 0; retentionStart = 0; truncated = false;
    lastWall = null; activeTime = 0; advancing = false; recentSpeeds = [];
  }
  function push(state) {
    const match = state.match;
    if (!match.id || match.status === 'none') { reset(); return; }
    const next = JSON.stringify([match.id, match.gameDataId, match.isObserver, match.isReplay,
      match.realBroadcasterPlayerId, [...state.capabilities].sort()]);
    if (signature !== next || match.gameTime < time) reset();
    const wall = now();
    if (!Number.isFinite(wall) || lastWall !== null && wall < lastWall) throw new RangeError('History clock must be finite and monotonic.');
    if (lastWall !== null && advancing) activeTime += wall - lastWall;
    lastWall = wall; advancing = !match.paused && ['running', 'starting'].includes(match.status);
    signature = next; time = match.gameTime;
    retentionStart = Math.max(retentionStart, time - maxSeconds);
    const speed = match.isReplay && Number.isFinite(match.gameSpeed) ? Math.min(64, Math.max(1, match.gameSpeed)) : 1;
    recentSpeeds = recentSpeeds.filter(sample => sample.at >= activeTime - 1000);
    while (recentSpeeds.length && recentSpeeds[recentSpeeds.length - 1].speed <= speed) recentSpeeds.pop();
    recentSpeeds.push({ at: activeTime, speed });
    const recentSpeed = recentSpeeds[0].speed;
    const visible = state.players.filter(p => match.isObserver || match.isReplay || p.id === match.realBroadcasterPlayerId);
    const present = new Set(visible.map(p => p.id));
    // Removed players lose their retained data, including contributions from transferred units.
    for (const [key, entry] of totals) if (!present.has(entry.playerId)) totals.delete(key);
    events = events.filter(event => present.has(event.playerId));
    for (const [id, unit] of units) if (!present.has(unit.playerId)) units.delete(id);
    for (const id of feeds.keys()) if (!present.has(id)) feeds.delete(id);
    intervals = intervals.filter(interval => present.has(interval.playerId));
    const observed = new Set();
    const ambiguous = new Set();
    for (const player of visible) for (const id of Object.keys(validPlayerStatistics(player.statistics) ? player.statistics.unitInstances ?? {} : {})) {
      if (observed.has(id)) ambiguous.add(id);
      observed.add(id);
    }
    observed.clear();
    for (const player of visible) {
      const stats = state.capabilities.includes('units') && validPlayerStatistics(player.statistics) ? player.statistics : undefined;
      const previous = feeds.get(player.id);
      const received = previous && stats?.gameTime === previous.at ? previous.received : activeTime;
      const tolerance = stats?.gameTime === previous?.at ? Math.max(recentSpeed, previous?.speed ?? 1) : recentSpeed;
      const fresh = stats?.unitInstances !== undefined && activeTime - received <= 5000 &&
        Math.abs(time - stats.gameTime) <= 5 * tolerance;
      const continuous = fresh && previous?.valid && activeTime - previous.received <= 5000 && stats.gameTime >= previous.at;
      if (!fresh) {
        feeds.set(player.id, { valid: false });
        for (const entry of totals.values()) if (entry.playerId === player.id) delete entry.present;
        continue;
      }
      feeds.set(player.id, { valid: true, at: stats.gameTime, received, speed: tolerance });
      let intervalValid = Boolean(continuous);
      for (const entry of totals.values()) if (entry.playerId === player.id) entry.present = false;
      for (const [id, current] of Object.entries(stats.unitInstances)) {
        // Ambiguous IDs in multiple player snapshots are never attributed twice.
        if (ambiguous.has(id)) {
          intervalValid = false; units.delete(id);
          for (const entry of totals.values()) if (entry.unitId === id) delete entry.present;
          continue;
        }
        observed.add(id);
        let unit = units.get(id);
        if (!unit && units.size >= maxUnits) { truncated = true; intervalValid = false; continue; }
        const entryKey = `${player.id}|${id}|${current.typeId}`;
        let entry = totals.get(entryKey);
        if (!entry && totals.size < maxUnits) {
          entry = { playerId: player.id, unitId: id, typeId: current.typeId, ...zero(),
            firstObservedGameTime: stats.gameTime, lastObservedGameTime: stats.gameTime, alive: current.alive, present: true };
          totals.set(entryKey, entry);
        }
        if (entry) Object.assign(entry, { lastObservedGameTime: stats.gameTime, alive: current.alive, present: true });
        else truncated = true;
        if (!unit) {
          unit = { playerId: player.id, typeId: current.typeId, counters: { ...current }, at: stats.gameTime, seen: time };
          units.set(id, unit);
          continue;
        }
        const regressed = COUNTERS.some(key => current[key] < unit.counters[key]);
        if (continuous && unit.seen === previous.time && !regressed && stats.gameTime > unit.at) {
          const delta = zero();
          for (const key of COUNTERS) delta[key] = current[key] - unit.counters[key];
          // A transfer/transformation interval has uncertain attribution: establish a new baseline.
          if (unit.playerId === player.id && unit.typeId === current.typeId) {
            if (COUNTERS.some(key => delta[key] > 0)) {
              const event = { playerId: player.id, unitId: id, typeId: current.typeId,
                fromGameTime: unit.at, gameTime: stats.gameTime, ...delta };
              events.push(event);
              if (entry) for (const counter of COUNTERS) entry[counter] += delta[counter];
            }
          } else intervalValid = false;
        } else if (regressed || unit.playerId !== player.id || unit.typeId !== current.typeId) intervalValid = false;
        Object.assign(unit, { playerId: player.id, typeId: current.typeId, counters: { ...current }, at: stats.gameTime, seen: time });
      }
      if (continuous && stats.gameTime > previous.at) intervals.push({ playerId: player.id, from: previous.at, to: stats.gameTime, valid: intervalValid });
      feeds.get(player.id).time = time;
    }
    events = events.filter(event => event.gameTime > retentionStart);
    if (events.length > maxEvents) {
      retentionStart = Math.max(retentionStart, events[events.length - maxEvents - 1].gameTime);
      events = events.slice(-maxEvents);
    }
    // Coverage intervals need the same memory bound, even when all counters remain zero.
    intervals = intervals.filter(interval => interval.to > retentionStart);
    if (intervals.length > maxEvents) {
      retentionStart = Math.max(retentionStart, intervals[intervals.length - maxEvents - 1].to);
      intervals = intervals.slice(-maxEvents);
    }
  }
  function matches(entry, query) {
    return (query.playerId === undefined || query.playerId === entry.playerId) &&
      (query.unitId === undefined || query.unitId === entry.unitId) &&
      (query.typeId === undefined || query.typeId === entry.typeId);
  }
  function sum(entries, query) {
    const result = zero();
    for (const entry of entries) if (matches(entry, query)) for (const key of COUNTERS) result[key] += entry[key];
    return result;
  }
  function contributions(query = {}) {
    return deepFreeze({ ...sum(totals.values(), query), truncated });
  }
  function entries(query = {}) {
    return deepFreeze([...totals.values()].filter(entry => matches(entry, query)).map(entry => ({ ...entry })));
  }
  function window(seconds, query = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Window seconds must be nonnegative.');
    const from = time - seconds;
    const selected = events.filter(event => event.gameTime > from && matches(event, query));
    const playerIds = query.playerId === undefined ? [...feeds.keys()] : [query.playerId];
    const covered = !truncated && from >= retentionStart && playerIds.length > 0 && playerIds.every(id => {
      if (!feeds.get(id)?.valid) return false;
      let through = from;
      for (const interval of intervals) if (interval.playerId === id && interval.to > through) {
        if (interval.from > through || !interval.valid) return false;
        through = interval.to;
        if (through >= time) return true;
      }
      return through >= time;
    });
    return deepFreeze({ ...sum(selected, {}), fromGameTime: from, toGameTime: time,
      events: selected.map(event => ({ ...event })), covered, complete: false,
      boundaryUncertain: selected.some(event => event.fromGameTime < from), truncated });
  }
  return Object.freeze({ push, reset, contributions, entries, window });
}
