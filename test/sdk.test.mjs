import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect, getOverlayComposition, PROTOCOL_VERSION, ProtocolError, SDK_VERSION, W3BoosterClient } from '../src/index.js';

test('runtime version matches the npm package version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(SDK_VERSION, manifest.version);
});

test('credentials cannot be sent to an insecure remote backend', async () => {
  const client = new W3BoosterClient({ clientId: 'safe_app', backend: 'http://example.com' });
  await assert.rejects(client.connect(), /must use HTTPS unless it targets localhost/);
});

test('one failing state listener cannot block other consumers', async () => {
  const reported = [];
  const client = new W3BoosterClient({ clientId: 'safe_app', demo: true });
  client.on('error', error => reported.push(error));
  client.state.subscribe(() => { throw new Error('consumer failed'); });
  let delivered = false;
  client.state.subscribe(() => { delivered = true; });
  await client.connect();
  assert.equal(delivered, true);
  assert.equal(reported[0]?.message, 'consumer failed');
  await client.disconnect();
});

test('custom transports cannot inject non-JSON state values', async () => {
  const client = new W3BoosterClient({
    clientId: 'safe_app',
    transport: {
      name: 'unsafe-test',
      async open(context) {
        context.onMessage({
          version: PROTOCOL_VERSION,
          sequence: 1,
          type: 'state.snapshot',
          data: { capabilities: [], match: { id: '', status: 'none', gameTime: 0, mode: 'none' }, players: [], extension: new Date() }
        });
      }
    }
  });
  const errors = [];
  client.on('error', error => errors.push(error));
  await client.connect();
  assert.equal(client.state.get(), null);
  assert.equal(errors[0]?.code, 'INVALID_MESSAGE');
});

test('host bridge opens app-owned windows without app-specific integration code', () => {
  const originalWindow = globalThis.window;
  const messages = [];
  const host = { postMessage(message, origin) { messages.push({ message, origin }); } };
  globalThis.window = { parent: host, opener: null };
  try {
    const client = new W3BoosterClient({ clientId: 'test_app' });
    assert.equal(client.host.available, true);
    assert.equal(client.host.openWindow({ path: '?view=compact', width: 500 }), true);
    assert.deepEqual(messages[0], {
      message: { source: 'w3booster-sdk', clientId: 'test_app', type: 'host.open-window', options: { path: '?view=compact', width: 500 } },
      origin: '*'
    });
    assert.equal(client.host.setSetting('layout', 'wide'), true);
    assert.deepEqual(messages[1].message, {
      source: 'w3booster-sdk',
      clientId: 'test_app',
      type: 'host.command',
      command: 'application.settings.set',
      payload: { path: 'layout', value: 'wide' }
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  }
});

test('embedded apps report their document height to the W3Booster host', () => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  const messages = [];
  const host = { postMessage(message) { messages.push(message); } };
  globalThis.window = { parent: host, opener: null };
  globalThis.document = {
    readyState: 'complete',
    documentElement: { scrollHeight: 720, offsetHeight: 700 },
    body: { scrollHeight: 680, offsetHeight: 680 }
  };
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
    disconnect() {}
  };
  try {
    const client = new W3BoosterClient({ clientId: 'test_app' });
    const resize = messages.find(message => message.type === 'host.resize');
    assert.equal(resize.height, 720);
    client.host.stopAutoResize();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('demo transport gives developers hydrated state', async () => {
  const client = await connect({ clientId: 'test_app', demo: { interval: 10 } });
  assert.equal(client.status, 'connected');
  assert.equal(client.diagnostics.transport, 'demo');
  assert.equal(client.match.getState().match.status, 'running');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(client.match.getState().match.gameTime >= 1);
  await client.disconnect();
});

test('the simplest connection uses configured scopes and exposes the state API without breaking aliases', async () => {
  const originalBridge = globalThis.__W3BOOSTER_SDK_BRIDGE__;
  let request;
  globalThis.__W3BOOSTER_SDK_BRIDGE__ = {
    async openStream(value) {
      request = value;
      return {
        onMessage(listener) {
          queueMicrotask(() => listener({
            version: PROTOCOL_VERSION,
            sequence: 1,
            type: 'state.snapshot',
            data: { match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
          }));
        },
        close() {}
      };
    }
  };
  try {
    const client = await connect('test_app');
    const state = await client.whenReady();
    assert.equal(state.match.status, 'none');
    assert.equal(client.state, client.match);
    assert.deepEqual(request.scopes, []);
    assert.deepEqual(request.protocolVersions, [PROTOCOL_VERSION]);
    assert.equal(client.diagnostics.sdkVersion, SDK_VERSION);
    assert.equal(client.diagnostics.protocolVersion, PROTOCOL_VERSION);
    await client.disconnect();
  } finally {
    if (originalBridge === undefined) delete globalThis.__W3BOOSTER_SDK_BRIDGE__;
    else globalThis.__W3BOOSTER_SDK_BRIDGE__ = originalBridge;
  }
});

test('patches are applied inside the SDK', async () => {
  let context;
  const transport = { name: 'test', async open(value) { context = value; }, close() {} };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  context.onMessage({ sequence: 1, type: 'state.snapshot', data: { match: { gameTime: 4 }, players: [] } });
  context.onMessage({ sequence: 2, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 5 }] });
  assert.equal(client.match.getState().match.gameTime, 5);
});

test('hydrated changes emit useful player, hero, inventory, and match events', async () => {
  let context;
  const transport = { name: 'test', async open(value) { context = value; } };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  const events = [];
  client.on('player.resources.changed', event => events.push(['resources', event]));
  client.on('hero.changed', event => events.push(['hero', event]));
  client.on('hero.inventory.changed', event => events.push(['inventory', event]));
  client.on('match.ended', event => events.push(['ended', event]));

  context.onMessage({ sequence: 1, type: 'state.snapshot', data: {
    capabilities: ['match', 'players', 'heroes', 'resources'],
    match: { id: 'one', status: 'running', gameTime: 10, mode: '1v1' },
    players: [{ id: '0', name: 'Player', resources: { gold: 100 }, heroes: [{ id: 'Hamg', name: 'Archmage', level: 1, items: ['ratf'] }] }]
  } });
  context.onMessage({ sequence: 2, type: 'state.patch', data: [
    { op: 'replace', path: '/players/0/resources/gold', value: 125 },
    { op: 'replace', path: '/players/0/heroes/0/level', value: 2 },
    { op: 'add', path: '/players/0/heroes/0/items/-', value: 'rin1' },
    { op: 'replace', path: '/match/status', value: 'finished' }
  ] });

  assert.equal(client.match.getPlayer('0').resources.gold, 125);
  assert.equal(events.find(([type]) => type === 'resources')[1].previousResources.gold, 100);
  assert.deepEqual(events.find(([type]) => type === 'inventory')[1].inventory, ['ratf', 'rin1']);
  assert.ok(events.find(([type]) => type === 'hero')[1].changedFields.includes('level'));
  assert.equal(events.find(([type]) => type === 'ended')[1].match.id, 'one');
});

test('watch only runs when its selected value changes', async () => {
  const storeChanges = [];
  let context;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.connect();
  client.match.watch(state => state.match.map, (map, previous) => storeChanges.push([map, previous]));
  context.onMessage({ sequence: 1, type: 'state.snapshot', data: { match: { map: 'A', gameTime: 1 }, players: [] } });
  context.onMessage({ sequence: 2, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 2 }] });
  context.onMessage({ sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/map', value: 'B' }] });
  assert.deepEqual(storeChanges, [['A', undefined], ['B', 'A']]);
});

test('application settings stay in state and emit a domain event', async () => {
  let context;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.connect();
  let change;
  client.on('application.settings.changed', event => { change = event; });
  context.onMessage({ sequence: 1, type: 'state.snapshot', data: {
    match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [],
    application: { clientId: 'test_app', settings: { layout: 'compact' } }
  } });
  context.onMessage({ sequence: 2, type: 'state.patch', data: [
    { op: 'replace', path: '/application/settings/layout', value: 'wide' }
  ] });
  assert.equal(client.match.getState().application.settings.layout, 'wide');
  assert.equal(change.previousSettings.layout, 'compact');
  assert.equal(change.settings.layout, 'wide');
});

test('synthetic upgrade level suffixes are normalized at state ingress', async () => {
  let context;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.connect();
  context.onMessage({ sequence: 1, type: 'state.snapshot', data: {
    match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
    players: [{
      id: '0',
      upgrades: {
        upgrades: [{ name: 'Rema3', gametime: 1 }],
        active: [{ name: 'Rhme2', gametime: 1, level: 2 }],
        researching: []
      }
    }]
  } });

  assert.equal(client.state.get().players[0].upgrades.upgrades[0].name, 'Rema');
  assert.equal(client.state.get().players[0].upgrades.active[0].name, 'Rhme');
});

test('sequence gaps request a resync instead of applying stale data', async () => {
  let context; let resyncs = 0;
  const transport = { name: 'test', async open(value) { context = value; }, resync() { resyncs++; } };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  context.onMessage({ sequence: 1, type: 'state.snapshot', data: { match: { gameTime: 1 }, players: [] } });
  context.onMessage({ sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 3 }] });
  assert.equal(resyncs, 1);
  assert.equal(client.match.getState().match.gameTime, 1);
  context.onMessage({ sequence: 4, type: 'state.snapshot', data: { match: { gameTime: 4 }, players: [] } });
  assert.equal(client.state.get().match.gameTime, 4);
});

test('a reconnect resets sequence tracking for the new snapshot', async () => {
  let context;
  const transport = { name: 'test', async open(value) { context = value; } };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  context.onMessage({ sequence: 20, type: 'state.snapshot', data: { match: { gameTime: 20 }, players: [] } });
  context.onStatus('reconnecting');
  context.onMessage({ sequence: 1, type: 'state.snapshot', data: { match: { gameTime: 21 }, players: [] } });
  assert.equal(client.match.getState().match.gameTime, 21);
});

test('the default cloud backend receives the launch credential without probing localhost', async () => {
  const original = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    location: globalThis.location,
    history: globalThis.history
  };
  const requests = [];
  globalThis.location = { hash: '#w3session=launch-secret', pathname: '/app', search: '' };
  globalThis.history = { replaceState(_state, _title, url) { requests.push({ cleanedUrl: url }); } };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization, credentials: options.credentials, body: JSON.parse(options.body) });
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=once' }; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    close() { this.readyState = 3; this.listeners.get('close')?.(); }
    send() { }
  };

  try {
    const client = await connect({ clientId: 'test_app' });
    const brokerRequests = requests.filter(request => request.url);
    assert.equal(brokerRequests.length, 1);
    assert.ok(brokerRequests.every(request => request.authorization === 'Bearer launch-secret'));
    assert.ok(brokerRequests.every(request => request.credentials === undefined));
    assert.match(brokerRequests[0].url, /^https:\/\/app\.w3booster\.com:14969\/stream\/v1\/stream-tickets$/);
    assert.deepEqual(brokerRequests[0].body.scopes, []);
    assert.deepEqual(brokerRequests[0].body.protocolVersions, [PROTOCOL_VERSION]);
    assert.equal(brokerRequests[0].body.sdkVersion, SDK_VERSION);
    assert.equal(requests[0].cleanedUrl, '/app');
    await client.disconnect();
  } finally {
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
    if (original.location === undefined) delete globalThis.location; else globalThis.location = original.location;
    if (original.history === undefined) delete globalThis.history; else globalThis.history = original.history;
  }
});

test('the platform launch parameter selects localhost without application-specific configuration', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, location: globalThis.location };
  const requests = [];
  globalThis.location = { search: '?view=dashboard&backend=local', hash: '', pathname: '/app' };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization });
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://localhost:25081/apps?ticket=once' }; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    close() { this.readyState = 3; this.listeners.get('close')?.(); }
    send() { }
  };

  try {
    const client = await connect({
      clientId: 'test_app',
      // Platform-issued launch configuration wins over app-specific transport choices.
      backend: 'cloud',
      tokenProvider: () => 'local-launch-secret'
    });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^https:\/\/localhost:25080\/stream\/v1\/stream-tickets$/);
    assert.equal(requests[0].authorization, 'Bearer local-launch-secret');
    await client.disconnect();
  } finally {
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
    if (original.location === undefined) delete globalThis.location; else globalThis.location = original.location;
  }
});

test('backend local never falls back to the cloud broker', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), credentials: options.credentials });
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://local.test/apps?ticket=once' }; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    close() { this.readyState = 3; this.listeners.get('close')?.(); }
    send() { }
  };

  try {
    const client = await connect({
      clientId: 'test_app',
      backend: 'local',
      tokenProvider: () => 'launch-secret'
    });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /^https:\/\/localhost:25080\/stream\/v1\/stream-tickets$/);
    assert.equal(requests[0].credentials, undefined);
    await client.disconnect();
  } finally {
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
  }
});

test('overlay composition authenticates a browser-source session', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body), authorization: options.headers.Authorization });
    if (String(url).includes('localhost')) throw new Error('local unavailable');
    if (String(url).includes('/compositor-sessions')) {
      return { ok: true, status: 200, async json() { return { sessionToken: 'compositor-session' }; } };
    }
    return { ok: true, async json() { return { apps: [{ appId: 'one', clientId: 'child', name: 'Child', url: 'https://child.test/#w3session=token' }] }; } };
  };
  try {
    const apps = await getOverlayComposition({
      surface: 'ingameOverlay',
      browserSource: { channel: 'user', secret: 'secret' }
    });
    assert.equal(apps[0].clientId, 'child');
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.url.startsWith('https://app.w3booster.com:14969/')));
    assert.match(requests[0].url, /\/stream\/v1\/compositor-sessions$/);
    assert.deepEqual(requests[0].body, { channel: 'user', secret: 'secret', surface: 'ingameOverlay' });
    assert.match(requests[1].url, /\/stream\/v1\/composite-launches$/);
    assert.equal(requests[1].authorization, 'Bearer compositor-session');
    assert.deepEqual(requests[1].body, { surface: 'ingameOverlay' });
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  }
});

test('the stable browser-source URL bootstraps composition without exposing credentials to apps', async () => {
  const original = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    history: globalThis.history,
    sessionStorage: globalThis.sessionStorage
  };
  const requests = [];
  let visibleAddress;
  const storage = new Map();
  globalThis.location = {
    hostname: 'localhost',
    pathname: '/overlay/',
    search: '?channel=user&secret=browser-source-secret&w3hwnd=42',
    hash: ''
  };
  globalThis.history = { replaceState(_state, _title, address) { visibleAddress = address; } };
  globalThis.sessionStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); }
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body), authorization: options.headers.Authorization });
    if (String(url).includes('/compositor-sessions')) {
      return { ok: true, status: 200, async json() { return { sessionToken: 'compositor-session' }; } };
    }
    return { ok: true, async json() { return { apps: [{ clientId: 'child-app' }] }; } };
  };
  try {
    const apps = await getOverlayComposition({ backend: 'local' });
    assert.equal(apps[0].clientId, 'child-app');
    assert.deepEqual(requests[0].body, {
      channel: 'user',
      secret: 'browser-source-secret',
      surface: 'ingameOverlay'
    });
    assert.equal(requests[1].authorization, 'Bearer compositor-session');
    assert.equal(visibleAddress, '/overlay/?w3hwnd=42');
    assert.equal(storage.get('w3booster.compositor.ingameOverlay'), 'compositor-session');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('unsupported protocol majors are rejected without mutating state', async () => {
  let context;
  let error;
  let resyncs = 0;
  const client = new W3BoosterClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; }, resync() { resyncs++; } }
  });
  client.on('error', value => { error = value; });
  await client.connect();
  context.onMessage({
    version: '2.0',
    sequence: 1,
    type: 'state.snapshot',
    data: { match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
  });
  assert.equal(client.state.get(), null);
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, 'UNSUPPORTED_PROTOCOL');
  assert.equal(resyncs, 1);
});

test('unsafe patch paths cannot mutate object prototypes', async () => {
  let context;
  let error;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  client.on('error', value => { error = value; });
  await client.connect();
  context.onMessage({
    version: '1.0', sequence: 1, type: 'state.snapshot',
    data: { match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
  });
  context.onMessage({
    version: '1.0', sequence: 2, type: 'state.patch',
    data: [{ op: 'add', path: '/__proto__/w3boosterPolluted', value: true }]
  });
  assert.equal(Object.prototype.w3boosterPolluted, undefined);
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, 'UNSAFE_PATCH');
});
