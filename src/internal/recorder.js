import { hasCapability } from './domain.js';
import { ConnectionError, ProtocolError } from './errors.js';
import { CONNECTION_TIMEOUT, isPlainObject } from './network.js';
import { assertSafeValue, deepEqual, structuredCloneSafe } from './values.js';
import { createReconnectBackoff } from './websocket.js';

const MAX_MESSAGE_LENGTH = 5 * 1024 * 1024;
const LOCAL_HERO_ALIASES = new Map([
  ['Edmm', 'Edem'], ['Nrob', 'Ntin'], ['Nalm', 'Nalc'], ['Nal2', 'Nalc'], ['Nal3', 'Nalc']
]);
const LOCAL_ABILITY_ALIASES = new Map([
  ['AUfa', 'AUfu'], ['ANc1', 'ANcs'], ['ANc2', 'ANcs'], ['ANc3', 'ANcs'],
  ['ANs1', 'ANsy'], ['ANs2', 'ANsy'], ['ANs3', 'ANsy'],
  ['ANg1', 'ANrg'], ['ANg2', 'ANrg'], ['ANg3', 'ANrg'], ['ANia', 'ANic']
]);
const LOCAL_UTILITY_ABILITIES = new Set([
  'AEtq', 'AHav', 'AEme', 'AEsf', 'AEsv', 'AHmt', 'AHpx', 'AHre', 'ANch', 'ANtm',
  'AOeq', 'AOre', 'AOvd', 'AOww', 'AUan', 'AUdd', 'AUin', 'ANef', 'ANrg', 'ANvc',
  'ANdo', 'ANst', 'ANto', 'AUls'
]);

/**
 * Low-latency transport for the recorder's observer/replay socket.
 * The platform snapshot remains authoritative for identity, permissions, and
 * settings; this feed only overlays volatile match values that the recorder
 * deliberately publishes only on the local system.
 */
export class LocalRecorderTransport {
  constructor({ enabled, onUpdates, onStatus, onError }) {
    this.enabled = enabled;
    this.onUpdates = onUpdates;
    this.onStatus = onStatus;
    this.onError = onError;
    this.urls = [];
    this.signature = '';
    this.matchId = '';
    this.latest = new Map();
    this.pending = new Map();
    this.socket = null;
    this.retryTimer = null;
    this.openTimer = null;
    this.updateFrame = null;
    this.updateFrameUsesAnimationFrame = false;
    this.reconnectBackoff = createReconnectBackoff({ initialDelay: 250, maxDelay: 5000 });
    this.urlIndex = 0;
    this.stopped = false;
    this.active = false;
  }

  configure(state) {
    const observerOrReplay = state?.match?.isObserver === true || state?.match?.isReplay === true;
    const active = state?.match?.status === 'starting' || state?.match?.status === 'running';
    const urls = active && observerOrReplay && this.enabled
      ? localRecorderUrls(state?.transport?.recorderUrls)
      : [];
    const signature = `${String(state?.match?.id || '')}|${urls.join('|')}`;
    if (signature === this.signature) return;

    this.stopSocket();
    this.signature = signature;
    this.matchId = String(state?.match?.id || '');
    this.urls = urls;
    this.latest.clear();
    this.pending.clear();
    this.reconnectBackoff.reset();
    this.urlIndex = 0;
    this.stopped = false;
    this.onStatus(false);
    if (urls.length) this.connect();
  }

  applyTo(state) {
    if (!state || !this.active || !this.latest.size || String(state.match?.id || '') !== this.matchId) return state;
    return applyLocalRecorderUpdates(state, [...this.latest.values()]);
  }

  close() {
    this.stopped = true;
    this.signature = '';
    this.urls = [];
    this.latest.clear();
    this.pending.clear();
    this.active = false;
    this.stopSocket();
    this.onStatus(false);
  }

  connect() {
    if (this.stopped || !this.urls.length ||
        typeof Reflect.get(globalThis, 'WebSocket') !== 'function' || this.socket) return;
    const url = this.urls[this.urlIndex++ % this.urls.length];
    let opened = false;
    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      const failOpening = () => {
        if (this.socket !== socket || opened) return;
        this.socket = null;
        if (this.openTimer !== null) clearTimeout(this.openTimer);
        this.openTimer = null;
        socket.close();
        this.scheduleReconnect();
      };
      this.openTimer = setTimeout(failOpening, CONNECTION_TIMEOUT);
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return;
        if (this.openTimer !== null) clearTimeout(this.openTimer);
        this.openTimer = null;
        opened = true;
        this.active = true;
        this.reconnectBackoff.reset();
        this.onStatus(true);
      });
      socket.addEventListener('message', event => {
        if (this.socket !== socket || !opened) return;
        try {
          const updates = parseLocalRecorderMessage(event.data);
          const applicable = updates.filter(update => updateMatchesMatch(update, this.matchId));
          if (!applicable.length) return;
          for (const update of applicable) {
            const cached = structuredCloneSafe(update);
            cached.__w3boosterReceivedAt = Date.now();
            const key = localUpdateKey(cached);
            if (!(cached.class === 'W3Unit' && cached.isHero)) this.pending.delete(key);
            this.pending.set(key, cached);
          }
          this.scheduleUpdateFrame();
        } catch (error) {
          this.onError(error instanceof ProtocolError
            ? error
            : new ProtocolError('INVALID_LOCAL_UPDATE', 'The local recorder update was invalid.', error));
        }
      });
      socket.addEventListener('error', () => {
        if (!opened) failOpening();
        else this.onError(new ConnectionError('The local recorder stream failed.'));
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        if (this.openTimer !== null) clearTimeout(this.openTimer);
        this.openTimer = null;
        this.socket = null;
        this.active = false;
        this.latest.clear();
        this.pending.clear();
        this.cancelUpdateFrame();
        this.onStatus(false);
        this.scheduleReconnect();
      });
    } catch (error) {
      if (this.openTimer !== null) clearTimeout(this.openTimer);
      this.openTimer = null;
      this.socket = null;
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.retryTimer || !this.urls.length) return;
    const delay = this.reconnectBackoff.nextDelay();
    if (delay === null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  scheduleUpdateFrame() {
    if (this.updateFrame !== null) return;
    const publish = () => {
      this.updateFrame = null;
      this.updateFrameUsesAnimationFrame = false;
      if (!this.active || !this.pending.size) return;
      const updates = [...this.pending.values()];
      this.pending.clear();
      if (!this.onUpdates(updates)) return;
      for (const update of updates) {
        const key = localUpdateKey(update);
        // Hero insertion order is first appearance, not last inventory update.
        // Other updates retain chronology (notably player-slot switches).
        if (!(update.class === 'W3Unit' && update.isHero)) this.latest.delete(key);
        this.latest.set(key, update);
      }
    };
    this.updateFrameUsesAnimationFrame = typeof Reflect.get(globalThis, 'requestAnimationFrame') === 'function' &&
      typeof Reflect.get(globalThis, 'cancelAnimationFrame') === 'function';
    this.updateFrame = this.updateFrameUsesAnimationFrame
      ? requestAnimationFrame(publish)
      : setTimeout(publish, 16);
  }

  cancelUpdateFrame() {
    if (this.updateFrame === null) return;
    if (this.updateFrameUsesAnimationFrame) cancelAnimationFrame(this.updateFrame);
    else clearTimeout(this.updateFrame);
    this.updateFrame = null;
    this.updateFrameUsesAnimationFrame = false;
  }

  stopSocket() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    this.openTimer = null;
    this.cancelUpdateFrame();
    const socket = this.socket;
    this.socket = null;
    this.active = false;
    socket?.close?.();
  }
}

function parseLocalRecorderMessage(value) {
  if (typeof value === 'string' && value.length > MAX_MESSAGE_LENGTH) {
    throw new ProtocolError('MESSAGE_TOO_LARGE', 'The local recorder update exceeded the safety limit.');
  }
  let updates;
  try { updates = typeof value === 'string' ? JSON.parse(value) : value; }
  catch (error) { throw new ProtocolError('INVALID_LOCAL_UPDATE', 'The local recorder update was not valid JSON.', error); }
  if (!Array.isArray(updates)) throw new ProtocolError('INVALID_LOCAL_UPDATE', 'Local recorder updates must be an array.');
  assertSafeValue(updates, 'local recorder updates');
  return updates.filter(isPlainObject);
}

function localRecorderUrls(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(candidate => {
    try {
      const parsed = new URL(String(candidate));
      if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
      if (!isLocalNetworkHost(parsed.hostname)) return null;
      return parsed.toString();
    } catch (_) { return null; }
  }).filter(Boolean)));
}

function isLocalNetworkHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
  const match = /^172\.(\d+)\./.exec(host);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function updateMatchesMatch(update, matchId) {
  return update.matchId === undefined || String(update.matchId) === String(matchId);
}

function localUpdateKey(update) {
  const playerId = localUpdatePlayerId(update);
  if (update.class === 'W3Resource') return `${update.class}:${playerId}:${String(update.type)}`;
  if (update.class === 'W3Player') return `${update.class}:${playerId}`;
  if (update.class === 'W3Unit') {
    const type = String(update.type);
    const identity = update.isHero ? (LOCAL_HERO_ALIASES.get(type) || type) : type;
    return `${update.class}:${playerId}:${identity}`;
  }
  if (update.class === 'W3Research') return `${update.class}:${playerId}:${String(update.type)}:${String(update.level)}`;
  return String(update.class || 'unknown');
}

export function applyLocalRecorderUpdates(state, updates) {
  let next = state;
  const playerIndexes = new Map((state.players || []).map((player, index) => [String(player.id), index]));

  const updateMatch = (field, value) => {
    if (Object.is(next.match?.[field], value)) return;
    next = { ...next, match: { ...next.match, [field]: value } };
  };
  const updateContext = (field, value) => {
    if (Object.is(next.gameContext[field], value)) return;
    next = { ...next, gameContext: { ...next.gameContext, [field]: value } };
  };
  const updatePlayer = (playerId, updater) => {
    const index = playerIndexes.get(String(playerId));
    if (index === undefined) return;
    const player = next.players[index];
    const updated = updater(player);
    if (updated === player) return;
    const players = [...next.players];
    players[index] = updated;
    next = { ...next, players };
  };

  for (const update of updates || []) {
    if (!isPlainObject(update) || !updateMatchesMatch(update, next.match?.id)) continue;
    if (update.class === 'W3GameTime' && hasCapability(next, 'match') && Number.isFinite(Number(update.value))) {
      updateMatch('gameTime', Number(update.value));
    } else if (update.class === 'W3ChatbarState') {
      updateContext('chatbarOpen', Number(update.value) === 1);
    } else if (update.class === 'W3HudScale') {
      const hudScale = normalizedHudScale(update.value);
      if (hudScale !== null) updateContext('hudScale', hudScale);
    } else if (update.class === 'W3TeamColor') {
      const value = Number(update.value);
      if (value === 0 || value === 1) updateContext('teamColors', value === 1);
    } else if (update.class === 'W3Resource' && hasCapability(next, 'resources')) {
      const resource = localResourceName(update.type);
      const value = Number(update.value);
      if (!resource || !Number.isFinite(value)) continue;
      const normalized = resource === 'gold' || resource === 'lumber' ? value / 10 : value;
      updatePlayer(localUpdatePlayerId(update), player => {
        if (Object.is(player.resources?.[resource], normalized)) return player;
        const resources = {
          gold: 0, lumber: 0, supply: 0, supplyCap: 0, workerSupply: 0,
          ...(player.resources || {}),
          [resource]: normalized
        };
        return { ...player, resources };
      });
    } else if (update.class === 'W3Player' && hasCapability(next, 'controlgroups') && isPlainObject(update.controlgroups)) {
      updatePlayer(localUpdatePlayerId(update), player => {
        if (String(player.id) !== String(next.match?.broadcasterPlayerId)) return player;
        const controlgroups = structuredCloneSafe(update.controlgroups);
        return deepEqual(player.controlgroups, controlgroups) ? player : { ...player, controlgroups };
      });
    } else if (update.class === 'W3PlayerSlot' && hasCapability(next, 'match') && Number.isFinite(Number(update.value))) {
      const broadcasterPlayerId = String(Number(update.value));
      updateMatch('broadcasterPlayerId', broadcasterPlayerId);
      updateMatch('realBroadcasterPlayerId', broadcasterPlayerId);
    } else if (update.class === 'W3Unit' && update.isHero && hasCapability(next, 'heroes')) {
      updatePlayer(localUpdatePlayerId(update), player => applyLocalHeroUpdate(player, update));
    } else if (update.class === 'W3Research' && hasCapability(next, 'upgrades')) {
      updatePlayer(localUpdatePlayerId(update), player => applyLocalResearchUpdate(player, update));
    }
  }
  return next;
}

function applyLocalHeroUpdate(player, update) {
  const heroId = LOCAL_HERO_ALIASES.get(String(update.type)) || String(update.type || '');
  if (!heroId) return player;
  const heroes = player.heroes || [];
  const index = heroes.findIndex(candidate => String(candidate.id) === heroId);
  const previousHero = index >= 0 ? heroes[index] : null;
  const receivedExperience = Number(update.experience);
  const experience = Number.isFinite(receivedExperience)
    ? receivedExperience
    : (previousHero?.experience ?? 0);
  let abilities = Array.isArray(update.abilities)
    ? [...update.abilities]
      .sort((left, right) => left?.order < right?.order ? 1 : -1)
      .filter(isPlainObject)
      .map(ability => {
        const name = LOCAL_ABILITY_ALIASES.get(String(ability.type)) || String(ability.type || '');
        return {
          id: `A${String(player.id)}${name}`,
          name,
          level: LOCAL_UTILITY_ABILITIES.has(name) ? 0 : Number(ability.level) || 0,
          ...(Number.isFinite(Number(ability.lastActivation)) && Number(ability.lastActivation) > 0
            ? { lastActivation: Number(ability.lastActivation) } : {})
        };
      })
    : (previousHero?.abilities || []);
  if (previousHero?.abilities && deepEqual(previousHero.abilities, abilities)) abilities = previousHero.abilities;
  let inventory = Array.isArray(update.inventory)
    ? structuredCloneSafe(update.inventory)
    : (previousHero?.inventory || []);
  if (previousHero?.inventory && deepEqual(previousHero.inventory, inventory)) inventory = previousHero.inventory;
  let hitpoints = update.hitpoints !== undefined ? structuredCloneSafe(update.hitpoints) : previousHero?.hitpoints;
  if (previousHero?.hitpoints && deepEqual(previousHero.hitpoints, hitpoints)) hitpoints = previousHero.hitpoints;
  let mana = update.mana !== undefined ? structuredCloneSafe(update.mana) : previousHero?.mana;
  if (previousHero?.mana && deepEqual(previousHero.mana, mana)) mana = previousHero.mana;
  const hero = {
    ...(previousHero || {}),
    id: heroId,
    name: previousHero?.name || heroId,
    experience,
    level: localHeroLevel(experience),
    abilities,
    inventory,
    ...(hitpoints !== undefined ? { hitpoints } : {}),
    ...(mana !== undefined ? { mana } : {})
  };
  if (previousHero && deepEqual(previousHero, hero)) return player;
  const nextHeroes = [...heroes];
  if (index >= 0) nextHeroes[index] = hero;
  else nextHeroes.push(hero);
  return { ...player, heroes: nextHeroes };
}

function applyLocalResearchUpdate(player, update) {
  const name = String(update.type || '');
  const level = Number(update.level);
  if (!name || !Number.isFinite(level)) return player;
  const gametime = Number(update.__w3boosterReceivedAt) || Date.now();
  const current = player.upgrades || { upgrades: [], active: [], researching: [] };
  let upgrades = current.upgrades || [];
  let active = current.active || [];
  const researching = current.researching || [];
  let changed = false;
  if (!upgrades.some(upgrade => upgrade.name === name && upgrade.level === level)) {
    upgrades = [...upgrades, { name, level, gametime }];
    changed = true;
  }
  const activeIndex = active.findIndex(upgrade => upgrade.name === name);
  if (activeIndex >= 0 && active[activeIndex].level !== level) {
    active = [...active];
    active[activeIndex] = { ...active[activeIndex], level };
    changed = true;
  } else if (activeIndex < 0) {
    active = [...active, { name, gametime, level }];
    changed = true;
  }
  if (!changed) return player;
  return { ...player, upgrades: { ...current, upgrades, active, researching } };
}

function localHeroLevel(experience) {
  const thresholds = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
  let level = 1;
  while (level < thresholds.length && experience >= thresholds[level]) level++;
  return level;
}

function localUpdatePlayerId(update) {
  return update.slotId ?? (update.class === 'W3Player' ? update.id : undefined);
}

function localResourceName(type) {
  switch (Number(type)) {
    case 1: return 'gold';
    case 2: return 'lumber';
    case 5: return 'supply';
    case 4: return 'supplyCap';
    case 99: return 'workerSupply';
    default: return null;
  }
}

function normalizedHudScale(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0 || raw > 128) return null;
  let percent = ((raw <= 24 ? raw / 2.4 : 10 + (raw - 24) / 1.15) * 10) / 10;
  percent = percent < 50 ? Math.round(percent) : Math.ceil(percent);
  return Math.max(0.5, Math.min(1, (percent / 100) * 0.5 + 0.5));
}
