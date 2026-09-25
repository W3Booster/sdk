// Private wire metadata. Public snapshots keep the existing numeric pool/timer shape.
const COLLECTIONS = ['units', 'heroes', 'buildings'];
const FIELDS = ['hitpoints', 'mana', 'construction', 'upgrade', 'production'];
export const STALE_AFTER_MS = 1000;
export const validAnchor = v => !!v && (v.clock === 0 || v.clock === 1) &&
  ['at', 'value', 'rate', 'min'].every(k => Number.isFinite(v[k]) && Math.abs(v[k]) <= 1e12) &&
  v.at >= 0 && v.min >= 0 && Number.isFinite(v.max) && v.max >= v.min && v.max <= 3.4028234663852886e38;
export const validClock = v => !!v && Number.isSafeInteger(v.sample) && v.sample >= 0 &&
  Number.isFinite(v.gameTime) && v.gameTime >= 0 && v.gameTime <= 1e12 &&
  Array.isArray(v.times) && v.times.length === 2 && v.times.every(t => Number.isFinite(t) && t >= 0 && t <= 1e12) &&
  Array.isArray(v.rates) && v.rates.length === 2 && v.rates.every(r => Number.isFinite(r) && r >= 0 && r <= 64) &&
  (v.ageMs === undefined || Number.isFinite(v.ageMs) && v.ageMs >= 0);
export const validInterpolation = v => !!v && validClock(v.clock) && Array.isArray(v.entries) && v.entries.length <= 32768 &&
  v.entries.every(e => e && typeof e.player === 'string' && COLLECTIONS.includes(e.collection) &&
    typeof e.id === 'string' && /^[0-9a-f]{16}$/.test(e.id) && FIELDS.includes(e.field) && validAnchor(e.anchor));
export const timingFields = v => v?.timing === undefined ? {} : { timing: { ...v.timing } };
export const validTiming = v => v?.timing === undefined || validAnchor(v.timing);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const entryKey = e => `${e.player}/${e.collection}/${e.id}/${e.field}`;

/** Extract local-recorder anchors after its existing permission projection. */
function prepare(state) {
  const { transport, ...publicState } = state;
  const entries = new Map((transport?.interpolation?.entries || []).map(e => [entryKey(e), e]));
  let players = state.players;
  for (let i = 0; i < (players || []).length; i++) {
    const sourcePlayer = players[i];
    let player = sourcePlayer;
    for (const collection of COLLECTIONS) for (const [id, sourceUnit] of Object.entries(sourcePlayer[collection] || {})) {
      let unit = sourceUnit;
      for (const field of FIELDS) {
        const source = field === 'production' ? sourceUnit.production?.queue?.[0] : sourceUnit[field];
        if (!source || source.timing === undefined) continue;
        const { timing, ...value } = source;
        const entry = { player: String(player.id), collection, id, field, anchor: timing };
        if (validAnchor(timing)) entries.set(entryKey(entry), entry);
        if (unit === sourceUnit) unit = { ...unit };
        unit[field] = field === 'production' ? { ...unit.production, queue: [value, ...unit.production.queue.slice(1)] } : value;
      }
      if (unit !== sourceUnit) {
        if (player === sourcePlayer) player = { ...player, [collection]: { ...player[collection] } };
        else if (player[collection] === sourcePlayer[collection]) player[collection] = { ...player[collection] };
        player[collection][id] = unit;
      }
    }
    if (player !== sourcePlayer) {
      if (players === state.players) players = [...players];
      players[i] = player;
    }
  }
  return { state: players === state.players ? publicState : { ...publicState, players }, entries: [...entries.values()] };
}

/** Pure projection: does not remove queues, complete jobs or invent semantic events. */
export function interpolateValues(state, entries, times) {
  let next = state;
  const indexes = new Map((state.players || []).map((p, i) => [String(p.id), i]));
  for (const entry of entries) {
    const index = indexes.get(String(entry.player));
    if (index === undefined) continue;
    const player = next.players[index], unit = player[entry.collection]?.[entry.id];
    const previous = entry.field === 'production' ? unit?.production?.queue?.[0] : unit?.[entry.field];
    if (!previous) continue; // Permission loss, destruction and queue removal stay authoritative.
    const a = entry.anchor;
    const value = clamp(a.value + (Math.max(a.at, times[a.clock]) - a.at) * a.rate, a.min, a.max);
    let updated;
    if (entry.field === 'hitpoints' || entry.field === 'mana') {
      const current = clamp(value, 0, previous.max);
      if (current === previous.current) continue;
      updated = { ...previous, current };
    } else {
      if (!(previous.totalSeconds > 0) || previous.remainingSeconds === null) continue;
      const remainingSeconds = clamp(value, 0, previous.totalSeconds), progress = 1 - remainingSeconds / previous.totalSeconds;
      if (remainingSeconds === previous.remainingSeconds && progress === previous.progress) continue;
      updated = { ...previous, remainingSeconds, progress };
    }
    const changedUnit = { ...unit, [entry.field]: entry.field === 'production'
      ? { ...unit.production, queue: [updated, ...unit.production.queue.slice(1)] } : updated };
    if (next === state) next = { ...state, players: [...state.players] };
    if (next.players[index] === state.players[index]) next.players[index] = { ...player };
    const changedPlayer = next.players[index];
    if (changedPlayer[entry.collection] === state.players[index][entry.collection]) {
      changedPlayer[entry.collection] = { ...changedPlayer[entry.collection] };
    }
    changedPlayer[entry.collection][entry.id] = changedUnit;
  }
  return next;
}

export class GameTimeInterpolator {
  constructor(onFrame, { now = () => performance.now(), schedule = fn => setTimeout(fn, 50), cancel = timer => clearTimeout(timer) } = {}) {
    this.onFrame = onFrame; this.now = now; this.schedule = schedule; this.cancel = cancel;
    /** @type {any} */ this.timer = null;
    /** @type {any} */ this.input = null;
    /** @type {any} */ this.clock = null;
    /** @type {number | null} */ this.displayedGameTime = null;
    this.received = 0; this.identity = ''; this.source = '';
  }
  update(raw) {
    const prepared = prepare(raw), incoming = raw.transport?.interpolation?.clock;
    const identity = String(raw.match?.id || ''), source = raw.transport?.interpolation?.source || 'server';
    if (this.identity !== identity || this.source !== source) this.reset();
    if (this.input?.state.match?.status !== prepared.state.match?.status) this.displayedGameTime = null;
    this.identity = identity; this.source = source; this.input = prepared;
    if (validClock(incoming) && (!this.clock || this.clock.sample !== incoming.sample)) {
      // Compare observations, not the extrapolated display: a genuine rewind or
      // restarted recorder must rebase immediately, even within the same second.
      if (this.clock && (incoming.gameTime < this.clock.gameTime || incoming.sample < this.clock.sample)) this.displayedGameTime = null;
      this.clock = { ...incoming, ageMs: incoming.ageMs || 0 }; this.received = this.now();
    } else if (!incoming) { this.clock = null; this.displayedGameTime = null; }
    const state = this.project(); this.start(); return state;
  }
  project() {
    const { state, entries } = this.input;
    if (!this.clock) return state;
    const elapsed = state.match?.status === 'finished' ? 0 : Math.min(STALE_AFTER_MS, Math.max(0, this.now() - this.received) + this.clock.ageMs) / 1000;
    const times = this.clock.times.map((t, i) => t + (state.match?.paused ? 0 : elapsed * this.clock.rates[i]));
    let next = interpolateValues(state, entries, times);
    // Keep the existing integer-second public clock, with no extra wire ticker.
    let gameTime = Math.floor(this.clock.gameTime + (state.match?.paused ? 0 : elapsed * this.clock.rates[0]));
    if (['running', 'starting'].includes(state.match?.status) && !state.match?.paused) {
      // Heartbeat latency/rate corrections can briefly cross a second boundary
      // backwards. Hold only the integer display; pools and timers above always
      // use the newly observed engine times. A transient zero rate is not a
      // rewind; explicit pauses and backward observed clocks still rebase.
      gameTime = Math.max(gameTime, this.displayedGameTime ?? gameTime);
      this.displayedGameTime = gameTime;
    } else this.displayedGameTime = null;
    if (['running', 'starting'].includes(state.match?.status) && Number.isFinite(state.match.gameTime) && gameTime !== state.match.gameTime) next = { ...next, match: { ...next.match, gameTime } };
    // Expose the measured rate, never the private clock/sample/anchor metadata.
    const gameSpeed = state.match?.paused || state.match?.status === 'finished' ? 0
      : Math.max(0, this.now() - this.received) + this.clock.ageMs < STALE_AFTER_MS ? this.clock.rates[0] : undefined;
    if (next.match.gameSpeed !== gameSpeed) {
      const { gameSpeed: previousSpeed, ...match } = next.match;
      next = { ...next, match: gameSpeed === undefined ? match : { ...match, gameSpeed } };
    }
    return next;
  }
  start() {
    if (this.timer !== null || !this.clock || !this.input || this.input.state.match?.status === 'finished' ||
        this.input.state.match?.paused || !this.clock.rates.some(r => r > 0) || this.now() - this.received + this.clock.ageMs >= STALE_AFTER_MS) return;
    this.timer = this.schedule(() => { this.timer = null; this.onFrame(this.project()); this.start(); });
    this.timer?.unref?.();
  }
  reset() { if (this.timer !== null) this.cancel(this.timer); this.timer = null; this.input = null; this.clock = null; this.displayedGameTime = null; }
}
