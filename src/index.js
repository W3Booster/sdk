import { SDK_VERSION, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './version.js';
import { createDemoTransport } from './testing.js';

export { SDK_VERSION, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './version.js';

const KNOWN_SCOPES = new Set(['match:read', 'players:read', 'stats:read', 'heroes:read', 'upgrades:read', 'resources:read', 'controlgroups:read', 'overlay:read']);
const DEFAULT_LOCAL_API = 'https://localhost:25080';
const DEFAULT_CLOUD_API = 'https://app.w3booster.com:14969';
const MAX_MESSAGE_LENGTH = 5 * 1024 * 1024;
const CONNECTION_TIMEOUT = 5000;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MATCH_STATUSES = new Set(['starting', 'running', 'finished', 'none']);
const RACES = new Set(['random', 'human', 'orc', 'undead', 'night-elf']);
const APP_SURFACES = new Set(['application', 'streamOverlay', 'ingameOverlay']);
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

/** Connect to W3Booster without choosing a local or cloud transport. */
export async function connect(options) {
  const client = new W3BoosterClient(options);
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

export class W3BoosterClient {
  constructor(options = {}) {
    this.options = normalizeConnectOptions(options);
    this.events = new W3BoosterEventEmitter();
    this.state = new StateStore(error => this.emit('error', error));
    this.host = new W3BoosterHost(this.options.clientId);
    this.host.startAutoResize();
    this.status = 'idle';
    this.diagnostics = { sdkVersion: SDK_VERSION, protocolVersion: null, transport: null, localTransport: null };
    this.sequence = 0;
    this.transport = null;
    this.pendingTransport = null;
    this.connectPromise = null;
    this.disconnectPromise = null;
    this.connectionController = null;
    this.connectionGeneration = 0;
    this.closedTransports = new WeakSet();
    this.localRecorderTransport = new LocalRecorderTransport({
      enabled: this.options.localRecorder !== false,
      onUpdates: updates => this.handleLocalRecorderUpdates(updates),
      onStatus: active => { this.diagnostics.localTransport = active ? 'recorder-local' : null; },
      onError: error => this.emit('error', error)
    });
  }

  async connect() {
    if (this.status === 'connected' || this.status === 'reconnecting') return this;
    if (this.connectPromise) return this.connectPromise;
    const generation = ++this.connectionGeneration;
    const controller = new AbortController();
    this.connectionController = controller;
    const externalSignal = this.options.signal;
    const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternalSignal();
    else externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    const attempt = this.openConnection(generation, controller.signal);
    this.connectPromise = attempt;
    try {
      return await attempt;
    } finally {
      externalSignal?.removeEventListener('abort', abortFromExternalSignal);
      if (this.connectPromise === attempt) this.connectPromise = null;
      if (this.connectionController === controller) this.connectionController = null;
    }
  }

  async openConnection(generation, signal) {
    throwIfAborted(signal);
    this.host.startAutoResize();
    this.setStatus('connecting');
    const candidates = this.options.transport
      ? [this.options.transport]
      : createTransportCandidates(this.options);
    const errors = [];

    for (const transport of candidates) {
      throwIfAborted(signal);
      this.closedTransports.delete(transport);
      this.pendingTransport = transport;
      try {
        await abortable(transport.open({
          clientId: this.options.clientId,
          scopes: [...this.options.scopes],
          protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
          signal,
          onMessage: message => {
            if (generation === this.connectionGeneration) this.handleMessage(message);
          },
          onStatus: status => {
            if (generation === this.connectionGeneration) this.setStatus(status);
          },
          onError: error => {
            if (generation === this.connectionGeneration) this.emit('error', error);
          }
        }), signal);
        throwIfAborted(signal);
        if (generation !== this.connectionGeneration) throw createAbortError();
        this.pendingTransport = null;
        this.transport = transport;
        this.diagnostics.transport = transport.name;
        this.setStatus('connected');
        return this;
      } catch (error) {
        if (this.pendingTransport === transport) this.pendingTransport = null;
        errors.push(error);
        await this.closeTransport(transport);
        if (signal.aborted || generation !== this.connectionGeneration || isAbortError(error)) throw createAbortError();
        if (error instanceof PermissionRequiredError) {
          this.setStatus('error');
          throw error;
        }
      }
    }

    this.setStatus('error');
    throw new ConnectionError('W3Booster is unavailable.', errors);
  }

  on(type, listener) {
    return this.events.on(type, listener);
  }

  once(type, listener) { return this.events.once(type, listener); }
  off(type, listener) { this.events.off(type, listener); }
  whenReady(options) { return this.state.whenReady(options); }

  async disconnect() {
    if (this.disconnectPromise) return this.disconnectPromise;
    const operation = this.closeConnection();
    this.disconnectPromise = operation;
    try { await operation; }
    finally { if (this.disconnectPromise === operation) this.disconnectPromise = null; }
  }

  async closeConnection() {
    const pendingConnection = this.connectPromise;
    this.connectionGeneration += 1;
    this.connectionController?.abort(createAbortError());
    this.connectionController = null;
    const transports = new Set([this.pendingTransport, this.transport].filter(Boolean));
    this.pendingTransport = null;
    this.transport = null;
    await Promise.allSettled([...transports].map(transport => this.closeTransport(transport)));
    if (pendingConnection) await Promise.allSettled([pendingConnection]);
    if (this.connectPromise === pendingConnection) this.connectPromise = null;
    this.localRecorderTransport.close();
    this.sequence = 0;
    this.state.reset();
    this.diagnostics.protocolVersion = null;
    this.diagnostics.transport = null;
    this.diagnostics.localTransport = null;
    this.host.stopAutoResize();
    this.setStatus('closed');
  }

  closeTransport(transport) {
    if (!transport || this.closedTransports.has(transport)) return;
    this.closedTransports.add(transport);
    return transport.close?.();
  }

  handleMessage(rawMessage) {
    let message;
    try {
      message = parseProtocolMessage(rawMessage);
      this.diagnostics.protocolVersion = message.version;
    } catch (error) {
      this.handleProtocolError(error);
      return;
    }

    if (message.sequence && this.sequence && message.sequence !== this.sequence + 1) {
      const expected = this.sequence + 1;
      this.sequence = 0;
      this.transport?.resync?.();
      this.emit('stream.gap', { expected, received: message.sequence });
      return;
    }
    if (message.sequence) this.sequence = message.sequence;

    const previousState = this.state.get();
    let nextState;
    try {
      if (message.type === 'state.snapshot') {
        nextState = validateState(message.data, this.options.clientId);
      } else if (message.type === 'state.patch') {
        if (!previousState) throw new ProtocolError('PATCH_WITHOUT_STATE', 'Received a state patch before the initial snapshot.');
        nextState = validateState(applyPatch(previousState, message.data), this.options.clientId);
      }
    } catch (error) {
      this.handleProtocolError(error);
      return;
    }
    if (nextState) {
      nextState = this.localRecorderTransport.applyTo(nextState);
      const state = this.state.setState(nextState);
      emitDomainEvents(previousState, state, (type, data) => this.emit(type, data));
      this.localRecorderTransport.configure(state);
      this.emit(message.type, message.type === 'state.snapshot' ? state : message.data);
      return;
    }
    this.emit(message.type, message.data);
  }

  handleProtocolError(error) {
    const protocolError = error instanceof ProtocolError
      ? error
      : new ProtocolError('INVALID_MESSAGE', error instanceof Error ? error.message : 'The stream message is invalid.', error);
    this.emit('error', protocolError);
    this.transport?.resync?.();
  }

  handleLocalRecorderUpdates(updates) {
    const previousState = this.state.get();
    if (!previousState) return;
    try {
      const nextState = validateState(applyLocalRecorderUpdates(previousState, updates), this.options.clientId);
      if (deepEqual(previousState, nextState)) return;
      const state = this.state.setState(nextState);
      emitDomainEvents(previousState, state, (type, data) => this.emit(type, data));
    } catch (error) {
      this.emit('error', error instanceof ProtocolError
        ? error
        : new ProtocolError('INVALID_LOCAL_UPDATE', 'The local recorder update was invalid.', error));
    }
  }

  emit(type, data) { this.events.emit(type, data); }

  setStatus(status) {
    if (status === 'reconnecting') this.sequence = 0;
    this.status = status;
    this.emit('status', status);
  }
}

/**
 * Low-latency transport for the recorder's observer/replay socket.
 * The platform snapshot remains authoritative for identity, permissions, and
 * settings; this feed only overlays volatile match values that the recorder
 * deliberately publishes only on the local system.
 */
class LocalRecorderTransport {
  constructor({ enabled, onUpdates, onStatus, onError }) {
    this.enabled = enabled;
    this.onUpdates = onUpdates;
    this.onStatus = onStatus;
    this.onError = onError;
    this.urls = [];
    this.signature = '';
    this.matchId = '';
    this.latest = new Map();
    this.socket = null;
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.urlIndex = 0;
    this.stopped = false;
    this.active = false;
  }

  configure(state) {
    const observerOrReplay = state?.match?.isObserver === true || state?.match?.isReplay === true;
    const active = state?.match?.status === 'starting' || state?.match?.status === 'running';
    const urls = active && observerOrReplay && this.enabled
      ? localRecorderUrls(state?.overlay?.misc?.localServerUrls)
      : [];
    const signature = `${String(state?.match?.id || '')}|${urls.join('|')}`;
    if (signature === this.signature) return;

    this.stopSocket();
    this.signature = signature;
    this.matchId = String(state?.match?.id || '');
    this.urls = urls;
    this.latest.clear();
    this.retryAttempt = 0;
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
    this.active = false;
    this.stopSocket();
    this.onStatus(false);
  }

  connect() {
    if (this.stopped || !this.urls.length || !globalThis.WebSocket || this.socket) return;
    const url = this.urls[this.urlIndex++ % this.urls.length];
    let opened = false;
    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return;
        opened = true;
        this.active = true;
        this.retryAttempt = 0;
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
            // Reinsert replacements so replaying the cache preserves the most
            // recent recorder ordering (notably player-slot switches).
            this.latest.delete(key);
            this.latest.set(key, cached);
          }
          this.onUpdates([...this.latest.values()]);
        } catch (error) {
          this.onError(error instanceof ProtocolError
            ? error
            : new ProtocolError('INVALID_LOCAL_UPDATE', 'The local recorder update was invalid.', error));
        }
      });
      socket.addEventListener('error', () => {
        if (opened) this.onError(new ConnectionError('The local recorder stream failed.'));
      });
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.active = false;
        this.latest.clear();
        this.onStatus(false);
        this.scheduleReconnect();
      });
    } catch (error) {
      this.socket = null;
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.retryTimer || !this.urls.length) return;
    const delay = Math.min(250 * (2 ** this.retryAttempt++), 5000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  stopSocket() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
  if (update.class === 'W3Unit') return `${update.class}:${playerId}:${String(update.type)}`;
  if (update.class === 'W3Research') return `${update.class}:${playerId}:${String(update.type)}:${String(update.level)}`;
  return String(update.class || 'unknown');
}

function applyLocalRecorderUpdates(state, updates) {
  const next = structuredCloneSafe(state);
  for (const update of updates || []) {
    if (!isPlainObject(update) || !updateMatchesMatch(update, next.match?.id)) continue;
    const player = next.players?.find(candidate => String(candidate.id) === String(localUpdatePlayerId(update)));
    if (update.class === 'W3GameTime' && hasCapability(next, 'match') && Number.isFinite(Number(update.value))) {
      next.match.gameTime = Number(update.value);
    } else if (update.class === 'W3ChatbarState' && hasCapability(next, 'overlay') && next.overlay?.misc) {
      next.overlay.misc.chatbarOpen = Number(update.value) === 1;
    } else if (update.class === 'W3HudScale' && hasCapability(next, 'overlay') && next.overlay?.misc) {
      const hudScale = normalizedHudScale(update.value);
      if (hudScale !== null) next.overlay.misc.hudScale = hudScale;
    } else if (update.class === 'W3TeamColor' && hasCapability(next, 'overlay') && next.overlay?.misc) {
      next.overlay.misc.teamColors = Boolean(update.value);
    } else if (update.class === 'W3Resource' && hasCapability(next, 'resources') && player) {
      const resource = localResourceName(update.type);
      const value = Number(update.value);
      if (!resource || !Number.isFinite(value)) continue;
      player.resources ||= { gold: 0, lumber: 0, supply: 0, supplyCap: 0, workerSupply: 0 };
      player.resources[resource] = resource === 'gold' || resource === 'lumber' ? value / 10 : value;
    } else if (update.class === 'W3Player' && hasCapability(next, 'controlgroups') && player &&
        String(player.id) === String(next.match?.broadcasterPlayerId) && isPlainObject(update.controlgroups)) {
      player.controlgroups = structuredCloneSafe(update.controlgroups);
    } else if (update.class === 'W3PlayerSlot' && hasCapability(next, 'match') && Number.isFinite(Number(update.value))) {
      const broadcasterPlayerId = String(Number(update.value));
      next.match.broadcasterPlayerId = broadcasterPlayerId;
      next.match.realBroadcasterPlayerId = broadcasterPlayerId;
    } else if (update.class === 'W3Unit' && update.isHero && hasCapability(next, 'heroes') && player) {
      applyLocalHeroUpdate(player, update);
    } else if (update.class === 'W3Research' && hasCapability(next, 'upgrades') && player) {
      applyLocalResearchUpdate(player, update);
    }
  }
  return next;
}

function hasCapability(state, capability) {
  return Array.isArray(state?.capabilities) && state.capabilities.includes(capability);
}

function applyLocalHeroUpdate(player, update) {
  const heroId = LOCAL_HERO_ALIASES.get(String(update.type)) || String(update.type || '');
  if (!heroId) return;
  const experience = Number(update.experience) || 0;
  const abilities = Array.isArray(update.abilities)
    ? [...update.abilities]
      .sort((left, right) => left?.order < right?.order ? 1 : -1)
      .filter(isPlainObject)
      .map(ability => {
        const name = LOCAL_ABILITY_ALIASES.get(String(ability.type)) || String(ability.type || '');
        return {
          id: `A${String(player.id)}${name}`,
          name,
          level: LOCAL_UTILITY_ABILITIES.has(name) ? 0 : Number(ability.level) || 0,
          lastActivation: Number(ability.lastActivation) || 0
        };
      })
    : [];
  const hero = {
    id: heroId,
    name: heroId,
    experience,
    level: localHeroLevel(experience),
    abilities,
    inventory: Array.isArray(update.inventory) ? structuredCloneSafe(update.inventory) : [],
    ...(update.hitpoints !== undefined ? { hitpoints: structuredCloneSafe(update.hitpoints) } : {}),
    ...(update.mana !== undefined ? { mana: structuredCloneSafe(update.mana) } : {})
  };
  player.heroes ||= [];
  const index = player.heroes.findIndex(candidate => String(candidate.id) === heroId);
  if (index >= 0) player.heroes[index] = hero;
  else player.heroes.push(hero);
}

function applyLocalResearchUpdate(player, update) {
  const name = String(update.type || '');
  const level = Number(update.level);
  if (!name || !Number.isFinite(level)) return;
  const gametime = Number(update.__w3boosterReceivedAt) || Date.now();
  player.upgrades ||= { upgrades: [], active: [], researching: [] };
  player.upgrades.upgrades ||= [];
  player.upgrades.active ||= [];
  player.upgrades.researching ||= [];
  if (!player.upgrades.upgrades.some(upgrade => upgrade.name === name && upgrade.level === level)) {
    player.upgrades.upgrades.push({ name, level, gametime });
  }
  const active = player.upgrades.active.find(upgrade => upgrade.name === name);
  if (active) active.level = level;
  else player.upgrades.active.push({ name, gametime, level });
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
  return (percent / 100) * 0.5 + 0.5;
}

/** Small host bridge for application surfaces embedded by W3Booster. */
export class W3BoosterHost {
  constructor(clientId) {
    this.clientId = clientId;
    this.resizeObserver = null;
    this.resizeFrame = null;
    this.resizeListener = null;
  }
  get available() { return !!hostWindow(); }
  openWindow(options = {}) { return this.post('host.open-window', { options }); }
  command(command, payload) {
    if (!command || typeof command !== 'string') throw new TypeError('command is required');
    return this.post('host.command', { command, payload });
  }
  setSetting(path, value) {
    if (!path || typeof path !== 'string') throw new TypeError('path is required');
    return this.command('application.settings.set', { path, value });
  }
  post(type, data) {
    const target = hostWindow();
    if (!target) return false;
    target.postMessage({ source: 'w3booster-sdk', clientId: this.clientId, type, ...data }, '*');
    return true;
  }
  startAutoResize() {
    if (!globalThis.document || !hostWindow() || this.resizeListener) return;
    const report = () => {
      this.resizeFrame = null;
      const root = document.documentElement;
      const body = document.body;
      const height = Math.max(
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0
      );
      if (height > 0) this.post('host.resize', { height });
    };
    this.resizeListener = () => {
      if (this.resizeFrame !== null) return;
      this.resizeFrame = globalThis.requestAnimationFrame
        ? requestAnimationFrame(report)
        : setTimeout(report, 0);
    };
    const observe = () => {
      if (globalThis.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(this.resizeListener);
        if (document.documentElement) this.resizeObserver.observe(document.documentElement);
        if (document.body) this.resizeObserver.observe(document.body);
      }
      globalThis.addEventListener?.('resize', this.resizeListener);
      this.resizeListener();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
    else observe();
  }
  stopAutoResize() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    globalThis.removeEventListener?.('resize', this.resizeListener);
    if (this.resizeFrame !== null) {
      if (globalThis.cancelAnimationFrame) cancelAnimationFrame(this.resizeFrame);
      else clearTimeout(this.resizeFrame);
    }
    this.resizeFrame = null;
    this.resizeListener = null;
  }
}

export class StateStore {
  constructor(onListenerError = reportListenerError) {
    this.state = null;
    this.subscribers = new Set();
    this.onListenerError = onListenerError;
  }
  get() { return this.state; }
  player(playerId) { return this.state?.players?.find(player => String(player.id) === String(playerId)) || null; }
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.subscribers.add(listener);
    if (this.state) this.notify(listener);
    return () => this.subscribers.delete(listener);
  }
  setState(nextState) {
    this.state = deepFreeze(structuredCloneSafe(nextState));
    [...this.subscribers].forEach(listener => this.notify(listener));
    return this.state;
  }
  reset() { this.state = null; }
  notify(listener) {
    try { listener(this.state); }
    catch (error) { this.onListenerError(error); }
  }
  watch(selector, listener) {
    let initialized = false;
    let previous;
    return this.subscribe(state => {
      const selected = selector(state);
      if (!initialized || !deepEqual(previous, selected)) {
        const before = previous;
        previous = structuredCloneSafe(selected);
        initialized = true;
        listener(selected, before, state);
      }
    });
  }
  whenReady(options = {}) {
    if (this.state) return Promise.resolve(this.state);
    const timeout = options.timeout === undefined ? 10000 : Number(options.timeout);
    if (!Number.isFinite(timeout) || timeout < 0) throw new TypeError('timeout must be a positive number');
    return new Promise((resolve, reject) => {
      let timer;
      const unsubscribe = this.subscribe(state => {
        if (timer) clearTimeout(timer);
        unsubscribe();
        resolve(state);
      });
      if (timeout > 0) {
        timer = setTimeout(() => {
          unsubscribe();
          reject(new ConnectionError('W3Booster did not provide its initial state in time.'));
        }, timeout);
      }
    });
  }
}

function hostWindow() {
  if (!globalThis.window) return null;
  if (window.parent && window.parent !== window) return window.parent;
  return window.opener || null;
}

export class W3BoosterEventEmitter {
  constructor() { this.listeners = new Map(); }
  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.off(type, listener);
  }
  once(type, listener) {
    const unsubscribe = this.on(type, data => {
      unsubscribe();
      listener(data);
    });
    return unsubscribe;
  }
  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
  }
  emit(type, data) {
    this.callListeners(type, data);
    this.callListeners('*', { type, data });
  }
  callListeners(type, data) {
    [...(this.listeners.get(type) || [])].forEach(listener => {
      try { listener(data); }
      catch (error) {
        if (type !== 'error' && type !== '*') this.callListeners('error', error);
        else reportListenerError(error);
      }
    });
  }
}

export class PermissionRequiredError extends Error {
  constructor(message, authorizeUrl) { super(message); this.name = 'PermissionRequiredError'; this.authorizeUrl = authorizeUrl; }
}
export class ConnectionError extends Error {
  constructor(message, causes = []) { super(message); this.name = 'ConnectionError'; this.causes = causes; }
}
export class ProtocolError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details;
  }
}

function normalizeConnectOptions(value) {
  const options = typeof value === 'string' ? { clientId: value } : value;
  if (!options || typeof options !== 'object') throw new TypeError('Connect with a client ID or options object.');
  const clientId = String(options.clientId || '').trim();
  if (!clientId) throw new TypeError('clientId is required');
  if (clientId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(clientId)) throw new TypeError('clientId is invalid');
  let scopes = [];
  if (options.scopes !== undefined && options.scopes !== 'configured') {
    if (!Array.isArray(options.scopes)) throw new TypeError('scopes must be configured or an array');
    scopes = Array.from(new Set(options.scopes.map(String)));
    const unknown = scopes.find(scope => !KNOWN_SCOPES.has(scope));
    if (unknown) throw new TypeError(`Unknown W3Booster scope: ${unknown}`);
  }
  return { ...options, clientId, scopes };
}

function createTransportCandidates(options) {
  const candidates = [];
  if (options.demo) {
    candidates.push(createDemoTransport(typeof options.demo === 'object' ? options.demo : {}));
    return candidates;
  }
  // Validate configured endpoints independently of runtime transport support.
  // This keeps configuration errors deterministic in older Node.js versions
  // and browsers that do not expose a native WebSocket implementation.
  const urls = backendUrls(options);
  if (globalThis.fetch && globalThis.WebSocket) {
    const credentialProvider = createCredentialProvider(options);
    urls.forEach((url, index) => {
      const name = url === (options.localApi || DEFAULT_LOCAL_API) ? 'local'
        : (url === (options.cloudApi || DEFAULT_CLOUD_API) ? 'cloud' : `backend-${index + 1}`);
      candidates.push(createBrokerTransport(name, url, credentialProvider));
    });
  }
  return candidates;
}

function backendUrls(options = {}) {
  const backend = launchBackendHint() || options.backend || 'cloud';
  const local = normalizeApiBase(options.localApi || DEFAULT_LOCAL_API, 'localApi');
  const cloud = normalizeApiBase(options.cloudApi || DEFAULT_CLOUD_API, 'cloudApi');
  if (backend === 'local') return [local];
  if (backend === 'cloud') return [cloud];
  if (backend !== 'auto') return [normalizeApiBase(backend, 'backend')];
  return [local, cloud];
}

function launchBackendHint() {
  try {
    const backend = new URLSearchParams(globalThis.location?.search || '').get('backend');
    return backend === 'local' || backend === 'cloud' ? backend : null;
  } catch (_) {
    return null;
  }
}

function normalizeApiBase(value, optionName) {
  let url;
  try { url = new URL(String(value || '')); }
  catch (_) { throw new TypeError(`${optionName} must be a valid HTTP(S) URL`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${optionName} must be an HTTP(S) URL`);
  }
  if (url.username || url.password) throw new TypeError(`${optionName} may not contain user information`);
  if (url.search || url.hash) throw new TypeError(`${optionName} may not contain a query or fragment`);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !local) {
    throw new TypeError(`${optionName} must use HTTPS unless it targets localhost`);
  }
  return url.toString().replace(/\/$/, '');
}

function createBrokerTransport(name, baseUrl, credentialProvider) {
  let socket;
  let pendingSocket;
  let context;
  let reconnectTimer;
  let reconnectAttempt = 0;
  let stopped = false;

  async function openSocket() {
    const credential = await credentialProvider();
    const response = await fetchWithTimeout(`${baseUrl}/stream/v1/stream-tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(credential ? { Authorization: `Bearer ${credential}` } : {})
      },
      body: JSON.stringify({
        clientId: context.clientId,
        scopes: context.scopes,
        protocolVersions: [...context.protocolVersions],
        sdkVersion: SDK_VERSION
      })
    }, CONNECTION_TIMEOUT, context.signal);

    if (response.status === 401 || response.status === 403) {
      const body = await response.json().catch(() => ({}));
      throw new PermissionRequiredError('This app has not been authorized.', body.authorizeUrl);
    }
    if (!response.ok) throw new Error(`${name} broker returned ${response.status}`);
    const ticket = await response.json();
    const negotiatedVersion = ticket?.protocolVersion;
    if (!supportsProtocolVersion(negotiatedVersion)) {
      throw new ProtocolError('UNSUPPORTED_PROTOCOL', `The server selected unsupported protocol ${negotiatedVersion}.`, { negotiatedVersion });
    }
    const websocketUrl = validateWebSocketUrl(ticket?.websocketUrl);
    await new Promise((resolve, reject) => {
      const candidate = new WebSocket(websocketUrl);
      pendingSocket = candidate;
      let opened = false;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', abort);
        if (pendingSocket === candidate) pendingSocket = null;
        callback(value);
      };
      const abort = () => {
        finish(reject, createAbortError());
        candidate.close();
      };
      const timer = setTimeout(() => {
        finish(reject, new ConnectionError(`${name} WebSocket did not open in time.`));
        candidate.close();
      }, CONNECTION_TIMEOUT);
      if (context.signal?.aborted) return abort();
      context.signal?.addEventListener('abort', abort, { once: true });
      candidate.addEventListener('open', () => {
        if (stopped || context.signal?.aborted) return abort();
        opened = true;
        socket = candidate;
        finish(resolve);
      }, { once: true });
      candidate.addEventListener('error', () => {
        const error = new Error(`${name} WebSocket failed`);
        if (!opened) finish(reject, error);
        else context.onError(error);
      });
      candidate.addEventListener('message', event => {
        if (socket === candidate) context.onMessage(event.data);
      });
      candidate.addEventListener('close', () => {
        if (socket === candidate) socket = null;
        if (!opened) finish(reject, new Error(`${name} WebSocket closed before connecting`));
        else if (!stopped) scheduleReconnect();
      });
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    context.onStatus('reconnecting');
    const delay = Math.min(500 * (2 ** reconnectAttempt), 10000);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await openSocket();
        reconnectAttempt = 0;
        context.onStatus('connected');
      } catch (error) {
        context.onError(error);
        if (error instanceof PermissionRequiredError) {
          context.onStatus('error');
          return;
        }
        reconnectAttempt += 1;
        scheduleReconnect();
      }
    }, delay);
  }

  return {
    name,
    async open(nextContext) {
      context = nextContext;
      stopped = false;
      await openSocket();
    },
    resync() { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stream.resync' })); },
    close() {
      stopped = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      pendingSocket?.close();
      pendingSocket = null;
      socket?.close();
      socket = null;
    }
  };
}

function createCredentialProvider(options) {
  let resolved = false;
  let credential = null;
  return async () => {
    if (resolved) return credential;
    credential = options.tokenProvider ? await options.tokenProvider() : readLaunchCredential(options.clientId);
    resolved = true;
    return credential;
  };
}

function readLaunchCredential(clientId) {
  if (!globalThis.location) return null;
  const hash = new URLSearchParams(globalThis.location.hash.replace(/^#/, ''));
  const session = hash.get('w3session');
  if (session) {
    hash.delete('w3session');
    globalThis.history?.replaceState(null, '', `${location.pathname}${location.search}${hash.size ? `#${hash}` : ''}`);
    try { globalThis.sessionStorage?.setItem(`w3booster.session.${clientId}`, session); } catch (_) { }
    return session;
  }
  try { return globalThis.sessionStorage?.getItem(`w3booster.session.${clientId}`) || null; } catch (_) { return null; }
}

async function fetchWithTimeout(url, options, timeout, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function emitDomainEvents(previous, state, emit) {
  emit('state.changed', { state, previousState: previous, initial: !previous });
  if (!previous) {
    emit('state.ready', { state });
    return;
  }

  const previousMatch = previous.match || {};
  const match = state.match || {};
  const sameMatch = String(previousMatch.id || '') === String(match.id || '');
  const wasActive = isActiveMatch(previousMatch);
  const isActive = isActiveMatch(match);
  if (wasActive && (!isActive || !sameMatch)) emit('match.ended', { match: previousMatch, nextMatch: match, state });
  if (isActive && (!wasActive || !sameMatch)) emit('match.started', { match, previousMatch, state });
  if (!deepEqual(previousMatch, match)) {
    emit('match.changed', { match, previousMatch, changedFields: changedKeys(previousMatch, match), state });
  }
  if (!deepEqual(previous.application?.settings, state.application?.settings)) {
    emit('application.settings.changed', {
      settings: state.application?.settings || {},
      previousSettings: previous.application?.settings || {},
      application: state.application,
      state
    });
  }

  const previousPlayers = indexById(previous.players);
  const players = indexById(state.players);
  const playerIds = new Set([...previousPlayers.keys(), ...players.keys()]);
  playerIds.forEach(playerId => {
    const previousPlayer = previousPlayers.get(playerId);
    const player = players.get(playerId);
    const playerContext = { playerId, player: player || previousPlayer, previousPlayer, state };
    if (!previousPlayer && player) emit('player.added', playerContext);
    if (previousPlayer && !player) {
      emitRemovedHeroes(playerId, previousPlayer, state, emit);
      emit('player.removed', playerContext);
      return;
    }
    if (!previousPlayer || !player) return;

    if (!deepEqual(previousPlayer, player)) {
      emit('player.changed', { ...playerContext, changedFields: changedKeys(previousPlayer, player) });
    }
    emitValueChange('player.resources.changed', playerContext, 'resources', previousPlayer.resources, player.resources, emit);
    emitValueChange('player.stats.changed', playerContext, 'stats', previousPlayer.stats, player.stats, emit);
    emitValueChange('player.upgrades.changed', playerContext, 'upgrades', previousPlayer.upgrades, player.upgrades, emit);
    emitHeroEvents(playerId, previousPlayer, player, state, emit);
  });
}

function emitValueChange(type, context, key, previousValue, value, emit) {
  if (!deepEqual(previousValue, value)) emit(type, { ...context, [key]: value, [`previous${capitalize(key)}`]: previousValue });
}

function emitHeroEvents(playerId, previousPlayer, player, state, emit) {
  const previousHeroes = indexById(previousPlayer.heroes);
  const heroes = indexById(player.heroes);
  const heroIds = new Set([...previousHeroes.keys(), ...heroes.keys()]);
  heroIds.forEach(heroId => {
    const previousHero = previousHeroes.get(heroId);
    const hero = heroes.get(heroId);
    const context = { playerId, player, heroId, hero: hero || previousHero, previousHero, state };
    if (!previousHero && hero) {
      emit('hero.added', context);
      return;
    }
    if (previousHero && !hero) {
      emit('hero.removed', context);
      return;
    }
    if (!previousHero || !hero || deepEqual(previousHero, hero)) return;
    emit('hero.changed', { ...context, changedFields: changedKeys(previousHero, hero) });
    const previousInventory = previousHero.inventory || [];
    const inventory = hero.inventory || [];
    if (!deepEqual(previousInventory, inventory)) {
      emit('hero.inventory.changed', { ...context, inventory, previousInventory });
    }
    if (!deepEqual(previousHero.abilities, hero.abilities)) {
      emit('hero.abilities.changed', { ...context, abilities: hero.abilities || [], previousAbilities: previousHero.abilities || [] });
    }
  });
}

function emitRemovedHeroes(playerId, player, state, emit) {
  indexById(player.heroes).forEach((hero, heroId) => {
    emit('hero.removed', { playerId, player, heroId, hero, previousHero: hero, state });
  });
}

function indexById(values) {
  return new Map((values || []).map((value, index) => [String(value?.id ?? index), value]));
}

function isActiveMatch(match) { return match?.status === 'starting' || match?.status === 'running'; }
function changedKeys(previous, current) {
  return Array.from(new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]))
    .filter(key => !deepEqual(previous?.[key], current?.[key]));
}
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }

function parseProtocolMessage(rawMessage) {
  if (typeof rawMessage === 'string' && rawMessage.length > MAX_MESSAGE_LENGTH) {
    throw new ProtocolError('MESSAGE_TOO_LARGE', 'The W3Booster stream message exceeded the safety limit.');
  }
  let message;
  try { message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage; }
  catch (error) { throw new ProtocolError('INVALID_JSON', 'The W3Booster stream sent invalid JSON.', error); }
  if (!isPlainObject(message)) throw new ProtocolError('INVALID_ENVELOPE', 'The W3Booster stream message must be an object.');
  const version = message.version;
  if (!supportsProtocolVersion(version)) {
    throw new ProtocolError('UNSUPPORTED_PROTOCOL', `Unsupported W3Booster protocol ${String(version)}.`, { receivedVersion: version });
  }
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 1) {
    throw new ProtocolError('INVALID_SEQUENCE', 'The W3Booster stream sequence must be a positive integer.');
  }
  if (typeof message.type !== 'string' || !message.type || message.type.length > 100) {
    throw new ProtocolError('INVALID_TYPE', 'The W3Booster stream message type is invalid.');
  }
  assertSafeValue(message.data, 'data');
  return { ...message, version };
}

function supportsProtocolVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+$/.test(version)) return false;
  const major = version.split('.')[0];
  return SUPPORTED_PROTOCOL_VERSIONS.some(supported => supported.split('.')[0] === major);
}

function validateState(value, clientId) {
  if (!isPlainObject(value)) throw new ProtocolError('INVALID_STATE', 'State must be an object.');
  assertSafeValue(value, 'state');
  const state = structuredCloneSafe(value);
  if (state.capabilities === undefined) state.capabilities = [];
  if (!Array.isArray(state.capabilities) || state.capabilities.some(item => typeof item !== 'string')) {
    throw new ProtocolError('INVALID_STATE', 'State capabilities must be an array of strings.');
  }
  if (!isPlainObject(state.match)) throw new ProtocolError('INVALID_STATE', 'State match is missing.');
  state.match.id ??= '';
  state.match.status ??= 'none';
  state.match.gameTime ??= 0;
  state.match.mode ??= 'undefined';
  if (typeof state.match.id !== 'string' || typeof state.match.status !== 'string' ||
      !Number.isFinite(state.match.gameTime) || typeof state.match.mode !== 'string') {
    throw new ProtocolError('INVALID_STATE', 'State match contains invalid core fields.');
  }
  if (!MATCH_STATUSES.has(state.match.status)) throw new ProtocolError('INVALID_STATE', `Unknown match status: ${state.match.status}`);
  validateOptionalFields(state.match, {
    map: 'string', realm: 'string', paused: 'boolean', isReplay: 'boolean', isReforged: 'boolean', isObserver: 'boolean',
    broadcasterPlayerId: 'string', realBroadcasterPlayerId: 'string', startedAt: 'string'
  }, 'State match');
  if (state.match.startedAt !== undefined && !Number.isFinite(Date.parse(state.match.startedAt))) {
    throw new ProtocolError('INVALID_STATE', 'State match startedAt must be an ISO-8601 timestamp.');
  }
  if (state.players === undefined) state.players = [];
  if (!Array.isArray(state.players)) throw new ProtocolError('INVALID_STATE', 'State players must be an array.');
  const playerIds = new Set();
  state.players.forEach((player, index) => {
    if (!isPlainObject(player) || typeof player.id !== 'string' || !player.id) {
      throw new ProtocolError('INVALID_STATE', `Player ${index} has no valid ID.`);
    }
    const id = player.id;
    if (playerIds.has(id)) throw new ProtocolError('INVALID_STATE', `Player ID ${id} occurs more than once.`);
    playerIds.add(id);
    validatePlayer(player, id);
    if (player.heroes !== undefined && !Array.isArray(player.heroes)) {
      throw new ProtocolError('INVALID_STATE', `Player ${id} heroes must be an array.`);
    }
    for (const hero of player.heroes || []) validateHero(hero, id);
    if (player.upgrades !== undefined) validateUpgrades(player.upgrades, id);
  });
  if (state.application !== undefined) {
    if (!isPlainObject(state.application) || state.application.clientId !== clientId) {
      throw new ProtocolError('APPLICATION_MISMATCH', 'This state belongs to a different application.');
    }
    if (!isPlainObject(state.application.settings)) {
      throw new ProtocolError('INVALID_STATE', 'Application settings must be an object.');
    }
    validateOptionalFields(state.application, { surface: 'string', development: 'boolean' }, 'Application state');
    if (state.application.surface !== undefined && !APP_SURFACES.has(state.application.surface)) {
      throw new ProtocolError('INVALID_STATE', `Unknown application surface: ${state.application.surface}`);
    }
  }
  if (state.overlay !== undefined) {
    if (!isPlainObject(state.overlay) || !isPlainObject(state.overlay.settings) || !isPlainObject(state.overlay.misc)) {
      throw new ProtocolError('INVALID_STATE', 'Overlay state must contain settings and misc objects.');
    }
    validateOptionalFields(state.overlay.misc, {
      chatbarOpen: 'boolean', hudScale: 'number', matchscoreWins: 'number', matchscoreLosses: 'number', teamColors: 'boolean'
    }, 'Overlay runtime state');
  }
  return state;
}

function validatePlayer(player, id) {
  validateOptionalFields(player, { name: 'string', team: 'number', colorId: 'number', isAI: 'boolean' }, `Player ${id}`);
  if (player.race !== undefined && (!RACES.has(player.race))) {
    throw new ProtocolError('INVALID_STATE', `Player ${id} has an invalid race.`);
  }
  if (player.startPosition !== undefined) validatePoint(player.startPosition, `Player ${id} startPosition`);
  if (player.resources !== undefined) validateResources(player.resources, id);
  if (player.controlgroups !== undefined) validateControlGroups(player.controlgroups, id);
  if (player.stats !== undefined) validateStatsCollection(player.stats, id);
  if (player.mainAccount !== undefined) validateMainAccount(player.mainAccount, id);
}

function validatePoint(value, label) {
  if (!isPlainObject(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new ProtocolError('INVALID_STATE', `${label} must contain finite x and y coordinates.`);
  }
}

function validateResources(resources, playerId) {
  if (!isPlainObject(resources)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} resources must be an object.`);
  for (const field of ['gold', 'lumber', 'supply', 'supplyCap']) {
    if (!Number.isFinite(resources[field])) throw new ProtocolError('INVALID_STATE', `Player ${playerId} resources.${field} must be a finite number.`);
  }
  if (resources.workerSupply !== undefined && !Number.isFinite(resources.workerSupply)) {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} resources.workerSupply must be a finite number.`);
  }
}

function validateControlGroups(controlgroups, playerId) {
  if (!isPlainObject(controlgroups)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} controlgroups must be an object.`);
  for (const [key, group] of Object.entries(controlgroups)) {
    if (!isPlainObject(group) || typeof group.frontunit !== 'string' || !Number.isFinite(group.size)) {
      throw new ProtocolError('INVALID_STATE', `Player ${playerId} controlgroup ${key} is invalid.`);
    }
  }
}

function validateStatsCollection(stats, playerId) {
  if (!isPlainObject(stats)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} stats must be an object.`);
  for (const key of ['solo', 'team', 'team4', 'ffa']) {
    const value = stats[key];
    if (value === undefined) continue;
    if (!isPlainObject(value) || !Number.isFinite(value.wins) || !Number.isFinite(value.losses) || !Number.isFinite(value.winRate)) {
      throw new ProtocolError('INVALID_STATE', `Player ${playerId} stats.${key} is invalid.`);
    }
    validateOptionalFields(value, { rank: 'number', level: 'number' }, `Player ${playerId} stats.${key}`);
    if (value.league !== undefined && typeof value.league !== 'string' && typeof value.league !== 'number') {
      throw new ProtocolError('INVALID_STATE', `Player ${playerId} stats.${key}.league is invalid.`);
    }
  }
}

function validateMainAccount(account, playerId) {
  if (!isPlainObject(account) || typeof account.name !== 'string') {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} mainAccount is invalid.`);
  }
  validateOptionalFields(account, { country: 'string' }, `Player ${playerId} mainAccount`);
  if (account.mainRace !== undefined && !RACES.has(account.mainRace) && !Number.isFinite(account.mainRace)) {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} mainAccount.mainRace is invalid.`);
  }
}

function validateHero(hero, playerId) {
  if (!isPlainObject(hero) || typeof hero.id !== 'string' || !hero.id || typeof hero.name !== 'string' || !Number.isFinite(hero.level)) {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} contains a hero without a valid ID.`);
  }
  if (Object.prototype.hasOwnProperty.call(hero, 'items')) {
    throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} must use inventory, not items.`);
  }
  if (hero.inventory !== undefined && (!Array.isArray(hero.inventory) || hero.inventory.some(item => typeof item !== 'string'))) {
    throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} inventory must be an array of rawcodes.`);
  }
  if (hero.experience !== undefined && !Number.isFinite(hero.experience)) {
    throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} experience must be a finite number.`);
  }
  for (const field of ['hitpoints', 'mana']) {
    if (hero[field] !== undefined && (!isPlainObject(hero[field]) || !Number.isFinite(hero[field].current) || !Number.isFinite(hero[field].max))) {
      throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} ${field} must contain finite current and max values.`);
    }
  }
  if (hero.abilities !== undefined) {
    if (!Array.isArray(hero.abilities)) throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} abilities must be an array.`);
    for (const ability of hero.abilities) {
      if (!isPlainObject(ability) || typeof ability.id !== 'string' || typeof ability.name !== 'string' || !Number.isFinite(ability.level) ||
          (ability.lastActivation !== undefined && !Number.isFinite(ability.lastActivation))) {
        throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} contains an invalid ability.`);
      }
    }
  }
}

function validateUpgrades(upgrades, playerId) {
  if (!isPlainObject(upgrades)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} upgrades must be an object.`);
  for (const collection of ['upgrades', 'active', 'researching']) {
    if (!Array.isArray(upgrades[collection])) {
      throw new ProtocolError('INVALID_STATE', `Player ${playerId} upgrades.${collection} must be an array.`);
    }
    for (const upgrade of upgrades[collection]) {
      if (!isPlainObject(upgrade) || typeof upgrade.name !== 'string' || !upgrade.name ||
          !Number.isFinite(upgrade.level) || upgrade.level < 1 || !Number.isFinite(upgrade.gametime)) {
        throw new ProtocolError('INVALID_STATE', `Player ${playerId} contains an invalid ${collection} upgrade.`);
      }
      if (upgrade.name.length > 4 && /^\d+$/.test(upgrade.name.slice(4))) {
        throw new ProtocolError('INVALID_STATE', `Upgrade ${upgrade.name} must carry its level separately.`);
      }
      if (collection === 'researching') {
        validateOptionalFields(upgrade, { researchStart: 'string', researchFinish: 'string' }, `Player ${playerId} researching upgrade`);
      }
    }
  }
}

function validateOptionalFields(value, fields, label) {
  for (const [field, type] of Object.entries(fields)) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== type || type === 'number' && !Number.isFinite(value[field])) {
      throw new ProtocolError('INVALID_STATE', `${label}.${field} must be a ${type}.`);
    }
  }
}

function applyPatch(current, operations) {
  if (!Array.isArray(operations)) throw new ProtocolError('INVALID_PATCH', 'State patch data must be an array.');
  let next = structuredCloneSafe(current || {});
  for (const operation of operations) {
    if (!isPlainObject(operation) || !['add', 'replace', 'remove'].includes(operation.op) || typeof operation.path !== 'string') {
      throw new ProtocolError('INVALID_PATCH', 'State patch contains an unsupported operation.');
    }
    if (operation.op !== 'remove') assertSafeValue(operation.value, 'patch.value');
    if (operation.path === '') {
      if (operation.op === 'remove') throw new ProtocolError('INVALID_PATCH', 'The complete state cannot be removed.');
      next = structuredCloneSafe(operation.value);
      continue;
    }
    if (!operation.path.startsWith('/')) throw new ProtocolError('INVALID_PATCH', 'State patch paths must be JSON pointers.');
    const path = operation.path.split('/').slice(1).map(decodePointerPart);
    if (path.some(part => UNSAFE_OBJECT_KEYS.has(part))) {
      throw new ProtocolError('UNSAFE_PATCH', 'State patch attempted to modify an unsafe object key.');
    }
    const key = path.pop();
    const parent = path.reduce((value, part) => value?.[part], next);
    if (parent == null || (typeof parent !== 'object' && !Array.isArray(parent))) {
      throw new ProtocolError('INVALID_PATCH', `State patch parent does not exist: ${operation.path}`);
    }
    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index > parent.length) {
        throw new ProtocolError('INVALID_PATCH', `State patch array index is invalid: ${operation.path}`);
      }
      if (operation.op === 'remove') {
        if (index >= parent.length) throw new ProtocolError('INVALID_PATCH', `State patch array item does not exist: ${operation.path}`);
        parent.splice(index, 1);
      } else if (operation.op === 'add') parent.splice(index, 0, structuredCloneSafe(operation.value));
      else {
        if (index >= parent.length) throw new ProtocolError('INVALID_PATCH', `State patch array item does not exist: ${operation.path}`);
        parent[index] = structuredCloneSafe(operation.value);
      }
    } else if (operation.op === 'remove') {
      if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new ProtocolError('INVALID_PATCH', `State patch property does not exist: ${operation.path}`);
      delete parent[key];
    } else {
      parent[key] = structuredCloneSafe(operation.value);
    }
  }
  return next;
}

function decodePointerPart(part) {
  if (/~(?:[^01]|$)/.test(part)) throw new ProtocolError('INVALID_PATCH', 'State patch contains an invalid JSON pointer escape.');
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}

function validateWebSocketUrl(value) {
  let url;
  try { url = new URL(String(value || '')); }
  catch (_) { throw new ProtocolError('INVALID_TICKET', 'The stream broker returned an invalid WebSocket URL.'); }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw new ProtocolError('INVALID_TICKET', 'The stream broker returned an unsupported WebSocket URL.');
  }
  if (url.username || url.password) throw new ProtocolError('INVALID_TICKET', 'WebSocket URLs may not contain user information.');
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'ws:' && !local) throw new ProtocolError('INSECURE_TICKET', 'Remote W3Booster streams must use WSS.');
  return url.toString();
}

function assertSafeValue(value, path, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new ProtocolError('INVALID_MESSAGE', `Non-finite numbers are not allowed at ${path}.`);
  }
  if (typeof value !== 'object') {
    throw new ProtocolError('INVALID_MESSAGE', `Only JSON values are allowed at ${path}.`);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new ProtocolError('INVALID_MESSAGE', `Only plain JSON objects are allowed at ${path}.`);
  }
  if (seen.has(value)) throw new ProtocolError('INVALID_MESSAGE', `Circular data is not allowed at ${path}.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`, seen));
  else {
    for (const key of Object.keys(value)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) throw new ProtocolError('UNSAFE_MESSAGE', `Unsafe object key at ${path}.${key}.`);
      assertSafeValue(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function reportListenerError(error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else globalThis.console?.error?.('W3Booster SDK listener failed:', error);
}

function createAbortError() {
  if (typeof globalThis.DOMException === 'function') return new DOMException('W3Booster connection was cancelled.', 'AbortError');
  const error = new Error('W3Booster connection was cancelled.');
  error.name = 'AbortError';
  return error;
}
function isAbortError(error) { return error?.name === 'AbortError'; }
function throwIfAborted(signal) { if (signal?.aborted) throw createAbortError(); }
function abortable(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function structuredCloneSafe(value) { if (value === undefined || value === null) return value; return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function deepFreeze(value) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    Object.values(item).forEach(child => pending.push(child));
    Object.freeze(item);
  }
  return value;
}
function deepEqual(left, right) { return left === right || JSON.stringify(left) === JSON.stringify(right); }
