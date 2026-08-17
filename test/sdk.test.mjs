import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect, PROTOCOL_VERSION, ProtocolError, SDK_VERSION, W3BoosterClient } from '../src/index.js';
import { getOverlayComposition, watchOverlayComposition } from '../src/compositor.js';

test('runtime version matches the npm package version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(SDK_VERSION, manifest.version);
});

test('platform compositor and testing utilities stay off the application root API', async () => {
  const sdk = await import('../src/index.js');
  assert.equal('getOverlayComposition' in sdk, false);
  assert.equal('watchOverlayComposition' in sdk, false);
  assert.equal('createDemoTransport' in sdk, false);
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
  assert.equal(client.state.get().match.status, 'running');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(client.state.get().match.gameTime >= 1);
  await client.disconnect();
});

test('the simplest client uses configured scopes and exposes the canonical state API', async () => {
  let request;
  const transport = {
    name: 'test',
    async open(value) {
      request = value;
      queueMicrotask(() => value.onMessage({
        version: PROTOCOL_VERSION,
        sequence: 1,
        type: 'state.snapshot',
        data: { match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
      }));
    },
    close() {}
  };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  const state = await client.whenReady();
  assert.equal(state.match.status, 'none');
  assert.deepEqual(request.scopes, []);
  assert.deepEqual(request.protocolVersions, [PROTOCOL_VERSION]);
  assert.equal(request.signal instanceof AbortSignal, true);
  assert.equal(client.diagnostics.sdkVersion, SDK_VERSION);
  assert.equal(client.diagnostics.protocolVersion, PROTOCOL_VERSION);
  await client.disconnect();
});

test('patches are applied inside the SDK', async () => {
  let context;
  const transport = { name: 'test', async open(value) { context = value; }, close() {} };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: { match: { gameTime: 4 }, players: [] } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 5 }] });
  assert.equal(client.state.get().match.gameTime, 5);
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

  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {
    capabilities: ['match', 'players', 'heroes', 'resources'],
    match: { id: 'one', status: 'running', gameTime: 10, mode: '1v1' },
    players: [{ id: '0', name: 'Player', resources: { gold: 100, lumber: 0, supply: 0, supplyCap: 0 }, heroes: [{ id: 'Hamg', name: 'Archmage', level: 1, inventory: ['ratf'] }] }]
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [
    { op: 'replace', path: '/players/0/resources/gold', value: 125 },
    { op: 'replace', path: '/players/0/heroes/0/level', value: 2 },
    { op: 'add', path: '/players/0/heroes/0/inventory/-', value: 'rin1' },
    { op: 'replace', path: '/match/status', value: 'finished' }
  ] });

  assert.equal(client.state.player('0').resources.gold, 125);
  assert.equal(events.find(([type]) => type === 'resources')[1].previousResources.gold, 100);
  assert.deepEqual(events.find(([type]) => type === 'inventory')[1].inventory, ['ratf', 'rin1']);
  assert.ok(events.find(([type]) => type === 'hero')[1].changedFields.includes('level'));
  assert.equal(events.find(([type]) => type === 'ended')[1].match.id, 'one');
});

test('the initial snapshot establishes a baseline before domain transition events', async () => {
  let context;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  const events = [];
  client.on('state.ready', () => events.push('ready'));
  client.on('match.started', event => events.push(`started:${event.match.id}`));
  client.on('match.ended', event => events.push(`ended:${event.match.id}`));
  await client.connect();

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: { match: { id: 'existing', status: 'running', gameTime: 10, mode: '1v1' }, players: [] }
  });
  assert.deepEqual(events, ['ready']);

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'state.snapshot',
    data: { match: { id: 'next', status: 'running', gameTime: 0, mode: '1v1' }, players: [] }
  });
  assert.deepEqual(events, ['ready', 'ended:existing', 'started:next']);
  await client.disconnect();
});

test('watch only runs when its selected value changes', async () => {
  const storeChanges = [];
  let context;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.connect();
  client.state.watch(state => state.match.map, (map, previous) => storeChanges.push([map, previous]));
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: { match: { map: 'A', gameTime: 1 }, players: [] } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 2 }] });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/map', value: 'B' }] });
  assert.deepEqual(storeChanges, [['A', undefined], ['B', 'A']]);
});

test('application settings stay in state and emit a domain event', async () => {
  let context;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.connect();
  let change;
  client.on('application.settings.changed', event => { change = event; });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {
    match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [],
    application: { clientId: 'test_app', settings: { layout: 'compact' } }
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [
    { op: 'replace', path: '/application/settings/layout', value: 'wide' }
  ] });
  assert.equal(client.state.get().application.settings.layout, 'wide');
  assert.equal(change.previousSettings.layout, 'compact');
  assert.equal(change.settings.layout, 'wide');
});

test('canonical upgrade rawcodes and explicit levels are preserved at state ingress', async () => {
  let context;
  const client = new W3BoosterClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.connect();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {
    match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
    players: [{
      id: '0',
      upgrades: {
        upgrades: [{ name: 'Rema', level: 3, gametime: 1 }],
        active: [{ name: 'Rhme', gametime: 1, level: 2 }],
        researching: []
      }
    }]
  } });

  assert.equal(client.state.get().players[0].upgrades.upgrades[0].name, 'Rema');
  assert.equal(client.state.get().players[0].upgrades.active[0].name, 'Rhme');
});

test('non-canonical hero inventory and upgrade suffixes are rejected', async () => {
  let context;
  const errors = [];
  const client = new W3BoosterClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.on('error', error => errors.push(error));
  await client.connect();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {
    match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
    players: [{ id: '0', heroes: [{ id: 'Hamg', name: 'Archmage', level: 1, items: ['ratf'] }] }]
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: {
    match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
    players: [{ id: '0', upgrades: {
      upgrades: [{ name: 'Rema2', level: 2, gametime: 1 }], active: [], researching: []
    } }]
  } });
  assert.equal(client.state.get(), null);
  assert.match(errors[0].message, /must use inventory/);
  assert.match(errors[1].message, /must carry its level separately/);
});

test('observer and replay sessions use the low-latency recorder transport locally', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, data) { this.listeners.get(type)?.(data === undefined ? {} : { data }); }
    close() { this.listeners.get('close')?.({}); }
  };

  let context;
  const client = new W3BoosterClient({
    clientId: 'match_vision',
    transport: { name: 'cloud-test', async open(value) { context = value; } }
  });
  try {
    await client.connect();
    const baseline = {
      capabilities: ['match', 'players', 'heroes', 'upgrades', 'resources', 'controlgroups', 'overlay'],
      match: {
        id: 'observer-match', status: 'running', gameTime: 1, mode: '1v1', isObserver: true,
        broadcasterPlayerId: '0', realBroadcasterPlayerId: '0'
      },
      players: [{
        id: '0',
        heroes: [],
        upgrades: { upgrades: [], active: [], researching: [] }
      }],
      overlay: { settings: { topBarGameDurationEnabled: false }, misc: { hudScale: 1, localServerUrls: ['ws://127.0.0.1:48123'] } },
      application: { clientId: 'match_vision', settings: {} }
    };
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: baseline });

    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].url, 'ws://127.0.0.1:48123/');
    sockets[0].emit('open');
    sockets[0].emit('message', JSON.stringify([
      { class: 'W3GameTime', matchId: 'observer-match', value: 12 },
      { class: 'W3HudScale', matchId: 'observer-match', value: 70 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 1, value: 1230 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 2, value: 670 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 5, value: 31 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 4, value: 50 },
      { class: 'W3Unit', matchId: 'observer-match', slotId: 0, type: 'Edmm', isHero: true, experience: 500,
        abilities: [{ type: 'AUfa', level: 2, order: 1, lastActivation: 9000 }], inventory: ['ratf'] },
      { class: 'W3Research', matchId: 'observer-match', slotId: 0, type: 'Rema', level: 2 }
    ]));

    let state = client.state.get();
    assert.equal(client.diagnostics.localTransport, 'recorder-local');
    assert.equal(state.match.gameTime, 12);
    assert.equal(state.overlay.misc.hudScale, 0.75);
    assert.deepEqual(state.players[0].resources, { gold: 123, lumber: 67, supply: 31, supplyCap: 50, workerSupply: 0 });
    assert.equal(state.players[0].heroes[0].id, 'Edem');
    assert.equal(state.players[0].heroes[0].level, 3);
    assert.equal(state.players[0].heroes[0].abilities[0].name, 'AUfu');
    assert.deepEqual(state.players[0].heroes[0].inventory, ['ratf']);
    assert.equal(state.players[0].upgrades.active[0].level, 2);

    // A cloud resnapshot remains the authenticated baseline, but it must not
    // erase recorder values already received through the local recorder feed.
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: baseline });
    state = client.state.get();
    assert.equal(state.overlay.misc.hudScale, 0.75);
    assert.equal(state.players[0].resources.gold, 123);
    assert.equal(state.players[0].heroes[0].id, 'Edem');

    context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/status', value: 'finished' }] });
    assert.equal(client.diagnostics.localTransport, null);
  } finally {
    await client.disconnect();
    if (originalWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWebSocket;
  }
});

test('the local recorder feed cannot bypass SDK capabilities', async () => {
  const originalWebSocket = globalThis.WebSocket;
  let socket;
  globalThis.WebSocket = class FakeWebSocket {
    constructor() { this.listeners = new Map(); socket = this; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, data) { this.listeners.get(type)?.({ data }); }
    close() { this.listeners.get('close')?.({}); }
  };
  let context;
  const client = new W3BoosterClient({
    clientId: 'overlay_only',
    transport: { name: 'cloud-test', async open(value) { context = value; } }
  });
  try {
    await client.connect();
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {
      capabilities: ['match', 'players', 'overlay'],
      match: { id: 'observer-match', status: 'running', gameTime: 1, mode: '1v1', isReplay: true },
      players: [{ id: '0' }],
      overlay: { settings: {}, misc: { hudScale: 1, localServerUrls: ['ws://localhost:48123'] } },
      application: { clientId: 'overlay_only', settings: {} }
    } });
    socket.emit('open');
    socket.emit('message', JSON.stringify([
      { class: 'W3HudScale', value: 70 },
      { class: 'W3Resource', slotId: 0, type: 1, value: 9990 }
    ]));
    assert.equal(client.state.get().overlay.misc.hudScale, 0.75);
    assert.equal(client.state.get().players[0].resources, undefined);
  } finally {
    await client.disconnect();
    if (originalWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWebSocket;
  }
});

test('a disconnected local recorder cannot mask newer authenticated snapshots', async () => {
  const originalWebSocket = globalThis.WebSocket;
  let socket;
  globalThis.WebSocket = class FakeWebSocket {
    constructor() { this.listeners = new Map(); socket = this; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, data) { this.listeners.get(type)?.(data === undefined ? {} : { data }); }
    close() { this.emit('close'); }
  };
  let context;
  const client = new W3BoosterClient({
    clientId: 'test_app',
    transport: { name: 'cloud-test', async open(value) { context = value; }, close() {} }
  });
  const snapshot = gold => ({
    capabilities: ['match', 'players', 'resources', 'overlay'],
    match: { id: 'observer-match', status: 'running', gameTime: 1, mode: '1v1', isObserver: true },
    players: [{ id: '0', resources: { gold, lumber: 0, supply: 0, supplyCap: 0 } }],
    overlay: { settings: {}, misc: { localServerUrls: ['ws://127.0.0.1:48123'] } },
    application: { clientId: 'test_app', settings: {} }
  });
  try {
    await client.connect();
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: snapshot(100) });
    socket.emit('open');
    socket.emit('message', JSON.stringify([
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 1, value: 1230 }
    ]));
    assert.equal(client.state.get().players[0].resources.gold, 123);
    socket.emit('close');
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: snapshot(200) });
    assert.equal(client.state.get().players[0].resources.gold, 200);
  } finally {
    await client.disconnect();
    if (originalWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWebSocket;
  }
});

test('sequence gaps request a resync instead of applying stale data', async () => {
  let context; let resyncs = 0;
  const transport = { name: 'test', async open(value) { context = value; }, resync() { resyncs++; } };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: { match: { gameTime: 1 }, players: [] } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 3 }] });
  assert.equal(resyncs, 1);
  assert.equal(client.state.get().match.gameTime, 1);
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 4, type: 'state.snapshot', data: { match: { gameTime: 4 }, players: [] } });
  assert.equal(client.state.get().match.gameTime, 4);
});

test('a reconnect resets sequence tracking for the new snapshot', async () => {
  let context;
  const transport = { name: 'test', async open(value) { context = value; } };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  await client.connect();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 20, type: 'state.snapshot', data: { match: { gameTime: 20 }, players: [] } });
  context.onStatus('reconnecting');
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: { match: { gameTime: 21 }, players: [] } });
  assert.equal(client.state.get().match.gameTime, 21);
});

test('explicit disconnect clears state and the same client can connect cleanly again', async () => {
  let context;
  let opens = 0;
  const transport = {
    name: 'test',
    async open(value) { context = value; opens += 1; },
    close() {}
  };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });

  await client.connect();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: { match: { id: 'first', status: 'running', gameTime: 1, mode: '1v1' }, players: [] }
  });
  assert.equal(client.state.get().match.id, 'first');

  await client.disconnect();
  assert.equal(client.state.get(), null);
  assert.equal(client.diagnostics.transport, null);
  assert.equal(client.diagnostics.protocolVersion, null);

  const ready = client.whenReady({ timeout: 0 });
  await client.connect();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: { match: { id: 'second', status: 'running', gameTime: 2, mode: '1v1' }, players: [] }
  });
  assert.equal((await ready).match.id, 'second');
  assert.equal(opens, 2);
  await client.disconnect();
});

test('connect is single-flight while a transport is opening', async () => {
  let release;
  let opens = 0;
  const transport = {
    name: 'deferred',
    open() {
      opens += 1;
      return new Promise(resolve => { release = resolve; });
    },
    close() {}
  };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  const first = client.connect();
  const second = client.connect();
  await Promise.resolve();
  assert.equal(opens, 1);
  release();
  assert.equal(await first, client);
  assert.equal(await second, client);
  await client.disconnect();
});

test('disconnect cancels an in-flight connection without allowing a late connected state', async () => {
  let closes = 0;
  let opens = 0;
  const transport = {
    name: 'never-opens',
    open() {
      opens += 1;
      return opens === 1 ? new Promise(() => {}) : Promise.resolve();
    },
    close() { closes += 1; }
  };
  const client = new W3BoosterClient({ clientId: 'test_app', transport });
  const connecting = client.connect();
  await Promise.resolve();
  await client.disconnect();
  await assert.rejects(connecting, error => error?.name === 'AbortError');
  assert.equal(closes, 1);
  assert.equal(client.status, 'closed');
  assert.equal(client.diagnostics.transport, null);
  await client.connect();
  assert.equal(client.status, 'connected');
  assert.equal(opens, 2);
  await client.disconnect();
});

test('an AbortSignal cancels the initial connection attempt', async () => {
  const controller = new AbortController();
  const client = new W3BoosterClient({
    clientId: 'test_app',
    signal: controller.signal,
    transport: { name: 'never-opens', open() { return new Promise(() => {}); }, close() {} }
  });
  const connecting = client.connect();
  controller.abort();
  await assert.rejects(connecting, error => error?.name === 'AbortError');
  await client.disconnect();
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
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=once', protocolVersion: PROTOCOL_VERSION }; } };
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

test('cancelling a broker connection closes a WebSocket that is still opening', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  let socket;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=once', protocolVersion: PROTOCOL_VERSION }; }
  });
  globalThis.WebSocket = class FakeWebSocket {
    constructor() { this.listeners = new Map(); this.closed = false; socket = this; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    close() { this.closed = true; this.listeners.get('close')?.(); }
  };
  const controller = new AbortController();
  try {
    const client = new W3BoosterClient({ clientId: 'test_app', tokenProvider: () => 'session', signal: controller.signal });
    const connecting = client.connect();
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(connecting, error => error?.name === 'AbortError');
    assert.equal(socket.closed, true);
    await client.disconnect();
  } finally {
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
  }
});

test('the platform launch parameter selects localhost without application-specific configuration', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, location: globalThis.location };
  const requests = [];
  globalThis.location = { search: '?view=dashboard&backend=local', hash: '', pathname: '/app' };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization });
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://localhost:25081/apps?ticket=once', protocolVersion: PROTOCOL_VERSION }; } };
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
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://local.test/apps?ticket=once', protocolVersion: PROTOCOL_VERSION }; } };
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

test('the stable browser-source URL remains reusable across compositor reloads', async () => {
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
    assert.equal(visibleAddress, undefined);
    assert.equal(globalThis.location.search, '?channel=user&secret=browser-source-secret&w3hwnd=42');
    assert.equal(storage.get('w3booster.compositor.ingameOverlay'), 'compositor-session');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('overlay composition changes arrive over an authenticated local websocket', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const sockets = [];
  const events = [];
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization, body: JSON.parse(options.body) });
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://localhost:25081/composition?surface=streamOverlay' }; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url, protocols) {
      this.url = String(url);
      this.protocols = protocols;
      this.listeners = new Map();
      sockets.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => listener());
    }
    close() { this.listeners.get('close')?.(); }
  };

  try {
    const watcher = await watchOverlayComposition({
      backend: 'local',
      surface: 'streamOverlay',
      tokenProvider: () => 'compositor-session'
    }, event => events.push(event));
    assert.deepEqual(requests, [{
      url: 'https://localhost:25080/stream/v1/composition-watch',
      authorization: 'Bearer compositor-session',
      body: { surface: 'streamOverlay' }
    }]);
    assert.equal(sockets[0].url, 'wss://localhost:25081/composition?surface=streamOverlay');
    assert.deepEqual(sockets[0].protocols, ['w3booster-compositor', 'compositor-session']);
    sockets[0].listeners.get('message')({ data: JSON.stringify({ type: 'composition.changed', surface: 'streamOverlay' }) });
    assert.deepEqual(events, [{ type: 'composition.changed', surface: 'streamOverlay' }]);
    watcher.close();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('overlay composition refreshes expired credentials and reauthorizes reconnects', async () => {
  const original = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    location: globalThis.location,
    sessionStorage: globalThis.sessionStorage
  };
  const storage = new Map([['w3booster.compositor.streamOverlay', 'expired-session']]);
  const authorizations = [];
  const sockets = [];
  let sessionNumber = 0;
  let watchNumber = 0;
  globalThis.location = { search: '?channel=user&secret=browser-source-secret', hash: '', pathname: '/overlay/' };
  globalThis.sessionStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); }
  };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/compositor-sessions')) {
      sessionNumber += 1;
      return { ok: true, status: 200, async json() { return { sessionToken: `fresh-session-${sessionNumber}` }; } };
    }
    watchNumber += 1;
    const authorization = options.headers.Authorization;
    authorizations.push(authorization);
    if (authorization === 'Bearer expired-session' || watchNumber === 3) {
      return { ok: false, status: 401, async json() { return {}; } };
    }
    return { ok: true, status: 200, async json() { return { websocketUrl: `wss://localhost:25081/composition?watch=${watchNumber}` }; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor(url, protocols) {
      this.url = String(url);
      this.protocols = protocols;
      this.readyState = 0;
      this.listeners = new Map();
      sockets.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    send() {}
    close() {
      this.readyState = 3;
      this.listeners.get('close')?.();
    }
  };

  let watcher;
  try {
    watcher = await watchOverlayComposition({ backend: 'local' }, () => {});
    assert.deepEqual(authorizations.slice(0, 2), ['Bearer expired-session', 'Bearer fresh-session-1']);
    assert.deepEqual(sockets[0].protocols, ['w3booster-compositor', 'fresh-session-1']);
    sockets[0].close();
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(sockets.length, 2);
    assert.equal(authorizations.at(-1), 'Bearer fresh-session-2');
    assert.deepEqual(sockets[1].protocols, ['w3booster-compositor', 'fresh-session-2']);
  } finally {
    watcher?.close();
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

test('runtime validation enforces the public state types', async () => {
  let context;
  const errors = [];
  const client = new W3BoosterClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.on('error', error => errors.push(error));
  await client.connect();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {
      match: { id: 'match', status: 'not-a-status', gameTime: 1, mode: '1v1' },
      players: []
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'state.snapshot',
    data: {
      match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [{ id: 7, resources: { gold: 'invalid' } }]
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 3,
    type: 'state.snapshot',
    data: {
      match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [{ id: '7', resources: { gold: 'invalid', lumber: 0, supply: 0, supplyCap: 0 } }]
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 4,
    type: 'state.snapshot',
    data: {
      match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [],
      overlay: { settings: {}, misc: { hudScale: 'invalid' } }
    }
  });
  assert.equal(client.state.get(), null);
  assert.match(errors[0]?.message, /Unknown match status/);
  assert.match(errors[1]?.message, /valid ID/);
  assert.match(errors[2]?.message, /resources.gold/);
  assert.match(errors[3]?.message, /hudScale/);
  await client.disconnect();
});

test('unversioned protocol envelopes are rejected', async () => {
  let context;
  let error;
  const client = new W3BoosterClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.on('error', value => { error = value; });
  await client.connect();
  context.onMessage({
    sequence: 1,
    type: 'state.snapshot',
    data: { match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
  });
  assert.equal(client.state.get(), null);
  assert.equal(error?.code, 'UNSUPPORTED_PROTOCOL');
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
