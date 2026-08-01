export const SDK_VERSION = '0.1.0';
export const PROTOCOL_VERSION = '1.0';
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_VERSION]);

const KNOWN_SCOPES = new Set(['match:read', 'players:read', 'stats:read', 'heroes:read', 'upgrades:read', 'resources:read', 'controlgroups:read', 'overlay:read']);
const DEFAULT_LOCAL_API = 'https://localhost:25080';
const DEFAULT_CLOUD_API = 'https://app.w3booster.com:14969';
const MAX_MESSAGE_LENGTH = 5 * 1024 * 1024;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Connect to W3Booster without choosing a local or cloud transport. */
export async function connect(options) {
  const client = new W3BoosterClient(options);
  await client.connect();
  return client;
}

/** Return authenticated child overlays for W3Booster's single overlay compositor. */
export async function getOverlayComposition(options = {}) {
  if (!globalThis.fetch) return [];
  const browserSource = readBrowserSource(options);
  const surface = options.surface || browserSource?.surface || 'streamOverlay';
  let credential = options.tokenProvider
    ? await options.tokenProvider()
    : (browserSource ? null : readCompositorCredential(surface));
  const bases = options.api ? [normalizeApiBase(options.api, 'api')] : backendUrls(options);
  const errors = [];
  for (let index = 0; index < bases.length; index++) {
    try {
      if (!credential && browserSource) {
        credential = await bootstrapBrowserSourceSession(
          bases[index],
          { ...browserSource, surface },
          index === 0 ? 500 : 5000
        );
      }
      const response = await fetchWithTimeout(`${bases[index]}/stream/v1/composite-launches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(credential ? { Authorization: `Bearer ${credential}` } : {})
        },
        body: JSON.stringify({ surface })
      }, index === 0 ? 500 : 5000);
      if (!response.ok) throw new Error(`overlay compositor returned ${response.status}`);
      const result = await response.json();
      return Array.isArray(result?.apps) ? result.apps : [];
    } catch (error) {
      errors.push(error);
    }
  }
  if (!credential && !browserSource) return [];
  throw new ConnectionError('Could not load enabled app overlays.', errors);
}

export class W3BoosterClient {
  constructor(options = {}) {
    this.options = normalizeConnectOptions(options);
    this.events = new W3BoosterEventEmitter();
    this.state = new StateStore(error => this.emit('error', error));
    this.match = this.state;
    this.host = new W3BoosterHost(this.options.clientId);
    this.host.startAutoResize();
    this.status = 'idle';
    this.diagnostics = { sdkVersion: SDK_VERSION, protocolVersion: null, transport: null };
    this.sequence = 0;
    this.transport = null;
  }

  async connect() {
    if (this.status === 'connected') return this;
    this.setStatus('connecting');
    const candidates = this.options.transport
      ? [this.options.transport]
      : createTransportCandidates(this.options);
    const errors = [];

    for (const transport of candidates) {
      try {
        await transport.open({
          clientId: this.options.clientId,
          scopes: [...this.options.scopes],
          protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
          onMessage: message => this.handleMessage(message),
          onStatus: status => this.setStatus(status),
          onError: error => this.emit('error', error)
        });
        this.transport = transport;
        this.diagnostics.transport = transport.name;
        this.setStatus('connected');
        return this;
      } catch (error) {
        errors.push(error);
        await transport.close?.();
        if (error instanceof PermissionRequiredError) throw error;
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
    await this.transport?.close?.();
    this.transport = null;
    this.sequence = 0;
    this.host.stopAutoResize();
    this.setStatus('closed');
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
      const state = this.state.setState(nextState);
      emitDomainEvents(previousState, state, (type, data) => this.emit(type, data));
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

  emit(type, data) { this.events.emit(type, data); }

  setStatus(status) {
    if (status === 'reconnecting') this.sequence = 0;
    this.status = status;
    this.emit('status', status);
  }
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
  getState() { return this.state; }
  player(playerId) { return this.getPlayer(playerId); }
  getPlayer(playerId) { return this.state?.players?.find(player => String(player.id) === String(playerId)) || null; }
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

/** @deprecated Use StateStore. */
export const MatchStore = StateStore;

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
  const bridge = globalThis.__W3BOOSTER_SDK_BRIDGE__ || globalThis.w3booster?.sdk;
  if (bridge?.openStream) candidates.push(createBridgeTransport(bridge));
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
  const backend = options.backend || 'auto';
  const local = normalizeApiBase(options.localApi || DEFAULT_LOCAL_API, 'localApi');
  const cloud = normalizeApiBase(options.cloudApi || DEFAULT_CLOUD_API, 'cloudApi');
  if (backend === 'local') return [local];
  if (backend === 'cloud') return [cloud];
  if (backend !== 'auto') return [normalizeApiBase(backend, 'backend')];
  return [local, cloud];
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

function readBrowserSource(options) {
  if (options.browserSource) return options.browserSource;
  if (!globalThis.location) return null;
  const parameters = new URLSearchParams(globalThis.location.search);
  const channel = parameters.get('channel');
  const secret = parameters.get('secret');
  if (!channel || !secret) return null;
  const surface = parameters.has('w3hwnd') ? 'ingameOverlay' : 'streamOverlay';
  return { channel, secret, surface };
}

function createBridgeTransport(bridge) {
  let stream;
  return {
    name: 'bridge',
    async open(context) {
      stream = await bridge.openStream({ clientId: context.clientId, scopes: context.scopes, protocolVersions: [...context.protocolVersions] });
      stream.onMessage(context.onMessage);
    },
    resync() { stream?.resync?.(); },
    close() { return stream?.close?.(); }
  };
}

function createBrokerTransport(name, baseUrl, credentialProvider) {
  let socket;
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
    }, name === 'local' ? 350 : 5000);

    if (response.status === 401 || response.status === 403) {
      const body = await response.json().catch(() => ({}));
      throw new PermissionRequiredError('This app has not been authorized.', body.authorizeUrl);
    }
    if (!response.ok) throw new Error(`${name} broker returned ${response.status}`);
    const ticket = await response.json();
    const negotiatedVersion = ticket?.protocolVersion || PROTOCOL_VERSION;
    if (!supportsProtocolVersion(negotiatedVersion)) {
      throw new ProtocolError('UNSUPPORTED_PROTOCOL', `The server selected unsupported protocol ${negotiatedVersion}.`, { negotiatedVersion });
    }
    const websocketUrl = validateWebSocketUrl(ticket?.websocketUrl);
    await new Promise((resolve, reject) => {
      const candidate = new WebSocket(websocketUrl);
      let opened = false;
      candidate.addEventListener('open', () => {
        opened = true;
        socket = candidate;
        resolve();
      }, { once: true });
      candidate.addEventListener('error', () => {
        const error = new Error(`${name} WebSocket failed`);
        if (!opened) reject(error);
        else context.onError(error);
      });
      candidate.addEventListener('message', event => context.onMessage(event.data));
      candidate.addEventListener('close', () => {
        if (socket === candidate) socket = null;
        if (!opened) reject(new Error(`${name} WebSocket closed before connecting`));
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

async function bootstrapBrowserSourceSession(baseUrl, connection, timeout = 5000) {
  const response = await fetchWithTimeout(`${baseUrl}/stream/v1/compositor-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: connection.channel,
      secret: connection.secret,
      surface: connection.surface || 'streamOverlay'
    })
  }, timeout);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new PermissionRequiredError(body.error || 'This browser source is not authorized.');
    }
    throw new Error(`overlay session broker returned ${response.status}`);
  }
  const result = await response.json();
  if (!result?.sessionToken) throw new Error('Overlay session broker returned no credential.');
  storeCompositorCredential(connection.surface || 'streamOverlay', result.sessionToken);
  hideBrowserSourceCredentials();
  return result.sessionToken;
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

function readCompositorCredential(surface) {
  try { return globalThis.sessionStorage?.getItem(`w3booster.compositor.${surface}`) || null; } catch (_) { return null; }
}

function storeCompositorCredential(surface, credential) {
  try { globalThis.sessionStorage?.setItem(`w3booster.compositor.${surface}`, credential); } catch (_) { }
}

function hideBrowserSourceCredentials() {
  if (!globalThis.location || !globalThis.history?.replaceState) return;
  const search = new URLSearchParams(globalThis.location.search || '');
  if (!search.has('channel') && !search.has('secret')) return;
  search.delete('channel');
  search.delete('secret');
  const query = search.toString();
  const path = `${globalThis.location.pathname || '/'}${query ? `?${query}` : ''}${globalThis.location.hash || ''}`;
  globalThis.history.replaceState(null, '', path);
}

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export function createDemoTransport(options = {}) {
  let timer;
  let sequence = 0;
  const state = structuredCloneSafe(options.state || createDemoState());
  return {
    name: 'demo',
    async open(context) {
      context.onMessage({ version: '1.0', sequence: ++sequence, type: 'state.snapshot', data: state });
      timer = setInterval(() => {
        state.match.gameTime += 1;
        state.players[0].resources.gold += 7;
        state.players[1].resources.gold += 6;
        context.onMessage({ version: '1.0', sequence: ++sequence, type: 'state.snapshot', data: state });
      }, options.interval || 1000);
    },
    close() { clearInterval(timer); },
    resync() { }
  };
}

function createDemoState() {
  return {
    capabilities: ['match', 'players', 'heroes', 'resources'],
    match: { id: 'demo-match', status: 'running', gameTime: 0, mode: '1v1', map: 'Echo Isles', realm: 'W3Champions' },
    players: [
      { id: '0', name: 'Northwind', race: 'human', team: 0, resources: { gold: 520, lumber: 185, supply: 34, supplyCap: 50 }, heroes: [{ id: 'Hamg', name: 'Archmage', level: 4 }] },
      { id: '1', name: 'Ironclaw', race: 'orc', team: 1, resources: { gold: 470, lumber: 210, supply: 38, supplyCap: 50 }, heroes: [{ id: 'Obla', name: 'Blademaster', level: 4 }] }
    ]
  };
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
    const previousInventory = previousHero.inventory || previousHero.items || [];
    const inventory = hero.inventory || hero.items || [];
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
  const version = message.version || PROTOCOL_VERSION;
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
  if (state.players === undefined) state.players = [];
  if (!Array.isArray(state.players)) throw new ProtocolError('INVALID_STATE', 'State players must be an array.');
  const playerIds = new Set();
  state.players.forEach((player, index) => {
    if (!isPlainObject(player) || (typeof player.id !== 'string' && typeof player.id !== 'number')) {
      throw new ProtocolError('INVALID_STATE', `Player ${index} has no valid ID.`);
    }
    const id = String(player.id);
    if (playerIds.has(id)) throw new ProtocolError('INVALID_STATE', `Player ID ${id} occurs more than once.`);
    playerIds.add(id);
    if (player.heroes !== undefined && !Array.isArray(player.heroes)) {
      throw new ProtocolError('INVALID_STATE', `Player ${id} heroes must be an array.`);
    }
    normalizePlayerUpgradeRawcodes(player);
  });
  if (state.application !== undefined) {
    if (!isPlainObject(state.application) || state.application.clientId !== clientId) {
      throw new ProtocolError('APPLICATION_MISMATCH', 'This state belongs to a different application.');
    }
    if (!isPlainObject(state.application.settings)) {
      throw new ProtocolError('INVALID_STATE', 'Application settings must be an object.');
    }
  }
  return state;
}

/** W3Booster historically appended an upgrade level to four-character rawcodes. Normalize at ingress. */
function normalizePlayerUpgradeRawcodes(player) {
  if (!isPlainObject(player.upgrades)) return;
  for (const collection of ['upgrades', 'active', 'researching']) {
    if (!Array.isArray(player.upgrades[collection])) continue;
    for (const upgrade of player.upgrades[collection]) {
      if (!isPlainObject(upgrade) || typeof upgrade.name !== 'string') continue;
      if (upgrade.name.length > 4 && /^\d+$/.test(upgrade.name.slice(4))) upgrade.name = upgrade.name.slice(0, 4);
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
