import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  classifyW3BoosterError,
  openClient,
  ConnectionError,
  createClient,
  PermissionRequiredError,
  PROTOCOL_VERSION,
  ProtocolError,
  SDK_VERSION,
  startClient,
  UNAVAILABLE_HOST_SNAPSHOT,
  W3BoosterClient
} from '../src/index.js';
import { getOverlayComposition, watchOverlayComposition } from '../src/compositor.js';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';
import { createDemoState } from '../src/testing.js';

const waitForRecorderFrame = () => new Promise(resolve => setTimeout(resolve, 25));
const waitForDeferredModule = async predicate => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for a deferred SDK module.');
};

test('runtime version matches the npm package version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(SDK_VERSION, manifest.version);
});

test('platform compositor and testing utilities stay off the application root API', async () => {
  const sdk = await import('../src/index.js');
  assert.equal('getOverlayComposition' in sdk, false);
  assert.equal('watchOverlayComposition' in sdk, false);
  assert.equal('createDemoTransport' in sdk, false);
  assert.equal('StateStore' in sdk, false);
  assert.equal('W3BoosterEventEmitter' in sdk, false);
  assert.equal('W3BoosterHost' in sdk, false);
});

test('runtime clients expose frozen read-only facades and reject direct construction', () => {
  assert.throws(() => new W3BoosterClient({ clientId: 'test_app' }), /createClient/);
  const client = createClient({ clientId: 'test_app', demo: true });
  assert.equal(Object.isFrozen(client), true);
  assert.equal(Object.isFrozen(client.state), true);
  assert.equal(Object.isFrozen(client.events), true);
  assert.equal(Object.isFrozen(client.lifecycle), true);
  assert.equal(Object.isFrozen(client.host), true);
  assert.equal('setState' in client.state, false);
  assert.equal('reset' in client.state, false);
  assert.equal('emit' in client.events, false);
  assert.equal('update' in client.lifecycle, false);
  assert.equal('authenticate' in client.host, false);
  assert.equal('disconnect' in client.host, false);
});

test('frontend errors have one stable discriminated classification', () => {
  const permission = new PermissionRequiredError('Open from W3Booster.', '/authorize');
  assert.deepEqual(classifyW3BoosterError(permission), {
    kind: 'permission', code: 'PERMISSION_REQUIRED', authorizeUrl: '/authorize',
    error: permission
  });
  const configuration = new ConnectionError('Missing app.', [], 'CONFIGURATION', 404);
  assert.deepEqual(classifyW3BoosterError(configuration), {
    kind: 'connection', code: 'CONFIGURATION', status: 404, error: configuration
  });
  assert.equal(classifyW3BoosterError(new DOMException('cancelled', 'AbortError')).kind, 'abort');
  assert.equal(classifyW3BoosterError(new Error('other')).kind, 'unknown');
  assert.equal(new PermissionRequiredError('unsafe', 'javascript:alert(1)').authorizeUrl, undefined);
  assert.equal(Object.isFrozen(configuration.causes), true);
});

test('credentials cannot be sent to an insecure remote backend', async () => {
  const client = createClient({ clientId: 'safe_app', backendUrl: 'http://example.com' });
  await assert.rejects(client.open(), /must use HTTPS unless it targets localhost/);
  assert.equal(client.status, 'error');
});

test('invalid frontend connection options fail early with actionable errors', async () => {
  assert.throws(() => createClient({ clientId: 'app', signal: {} }), /AbortSignal/);
  assert.throws(() => createClient({ clientId: 'app', demo: 'yes' }), /demo/);
  assert.throws(() => createClient({ clientId: 'app', tokenProvider: 'token' }), /tokenProvider/);
  assert.throws(() => createClient({ clientId: 'app', autoResize: 'yes' }), /autoResize/);
  assert.throws(() => createClient({ clientId: 'app', retry: { maxAttempts: 0 } }), /maxAttempts/);
  const unlimitedRetry = createClient({ clientId: 'app', retry: true });
  await assert.rejects(unlimitedRetry.open(), /AbortSignal/);
  assert.throws(() => createClient({ clientId: 'app', reconnect: { maxAttempts: 0 } }), /reconnect.maxAttempts/);
  assert.throws(() => createClient({ clientId: 'app', backend: '' }), /auto, local, or cloud/);
  assert.throws(() => createClient({ clientId: 'app', backend: 'locla' }), /auto, local, or cloud/);
  assert.throws(() => createClient({ clientId: 'app', backendUrl: '' }), /backendUrl/);
  assert.throws(() => createClient({ clientId: 'app', backend: 'cloud', backendUrl: 'https://example.com' }), /either backend or backendUrl/);
  assert.throws(() => createClient({ clientId: 'app', demo: { settings: [] } }), /demo.settings/);
  assert.throws(() => createClient({ clientId: 'app', demo: { surface: 'window' } }), /demo.surface/);
});

test('startup signals own unlimited initial retry waits without becoming client lifetime signals', async () => {
  const startup = new AbortController();
  const client = await startClient({
    clientId: 'app',
    retry: true,
    demo: { interval: 0 }
  }, { signal: startup.signal });
  startup.abort();
  await Promise.resolve();
  assert.equal(client.status, 'connected');
  await client.disconnect();
});

test('aborting a pending transport normalizes premature connected status to closed', async () => {
  let context;
  let closes = 0;
  const client = createClient({
    clientId: 'app',
    transport: {
      name: 'premature-connected',
      open(value) {
        context = value;
        return new Promise(() => {});
      },
      close() { closes += 1; }
    }
  });
  const startup = new AbortController();
  const opening = client.open({ signal: startup.signal });
  await Promise.resolve();
  context.onStatus('connected');
  assert.equal(client.status, 'connected');
  startup.abort();
  await assert.rejects(opening, error => error?.name === 'AbortError');
  assert.equal(closes, 1);
  assert.equal(client.status, 'closed');
  assert.equal(client.lifecycle.get().status, 'closed');
  assert.equal(client.state.get(), null);
});

test('initial connection retries remain connecting rather than claiming a reconnection', async () => {
  let attempts = 0;
  const statuses = [];
  const lifecycle = [];
  const transientFailure = new ConnectionError('offline');
  const client = createClient({
    clientId: 'app',
    retry: { maxAttempts: 2, initialDelay: 0, maxDelay: 0 },
    transport: {
      name: 'retry-once',
      open() {
        attempts += 1;
        if (attempts === 1) throw transientFailure;
      },
      close() {}
    }
  });
  client.subscribeStatus(status => statuses.push(status));
  client.lifecycle.subscribe(snapshot => lifecycle.push(snapshot));
  await client.open();
  assert.equal(attempts, 2);
  assert.equal(statuses.includes('reconnecting'), false);
  assert.equal(lifecycle.some(snapshot => snapshot.status === 'connecting' &&
    snapshot.retry?.attempt === 2 && snapshot.retry.maxAttempts === 2 &&
    snapshot.retry.nextDelay === 0 && snapshot.retry.lastError instanceof ConnectionError), true);
  assert.equal(client.lifecycle.get().retry, null);
  assert.equal(client.status, 'connected');
  await client.disconnect();
});

test('the canonical unavailable host snapshot is immutable and used by new clients', () => {
  const client = createClient({ clientId: 'app', demo: true });
  assert.equal(client.host.lifecycle.get(), UNAVAILABLE_HOST_SNAPSHOT);
  assert.equal(Object.isFrozen(UNAVAILABLE_HOST_SNAPSHOT), true);
  assert.equal(Object.isFrozen(UNAVAILABLE_HOST_SNAPSHOT.capabilities), true);
});

test('host actions validate JavaScript inputs before contacting the host', async () => {
  const client = createClient({ clientId: 'app', demo: true });
  assert.throws(() => client.host.openWindow(null), /options must be an object/);
  assert.throws(() => client.host.openWindow({ width: 0 }), /width must be a positive number/);
  assert.throws(() => client.host.openWindow({ title: 42 }), /title must be a string/);
  assert.throws(() => client.host.openWindow({}, { signal: {} }), /AbortSignal/);
  assert.throws(() => client.host.closeWindow({ timeout: 0 }), /positive number/);
  assert.throws(() => client.host.command('   '), /non-empty string/);
  assert.throws(() => client.host.command('valid', undefined, { parse: true }), /parser must be a function/);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    client.host.refreshCapabilities({ signal: cancelled.signal }),
    error => error?.name === 'AbortError'
  );
  await assert.rejects(
    client.host.refreshCapabilities(),
    error => error?.code === 'HOST_UNAVAILABLE'
  );
});

test('retry fails promptly when required browser transport APIs are unavailable', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  delete globalThis.fetch;
  delete globalThis.WebSocket;
  try {
    const client = createClient({ clientId: 'safe_app', retry: true, signal: new AbortController().signal });
    await assert.rejects(client.open(), /must provide fetch and WebSocket/);
    assert.equal(client.status, 'error');
    await client.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('permanent broker responses expose configuration errors without retrying', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return { ok: false, status: 404, async json() { return {}; } };
  };
  globalThis.WebSocket = class {};
  try {
    const client = createClient({
      clientId: 'missing_app',
      retry: { maxAttempts: 5, initialDelay: 0, maxDelay: 0 }
    });
    const issues = [];
    const lifecycle = [];
    client.on('issue', issue => issues.push(issue));
    client.lifecycle.subscribe(snapshot => lifecycle.push(snapshot));
    await assert.rejects(client.open(), error => error?.code === 'CONFIGURATION' && error?.status === 404);
    assert.equal(requests, 1);
    assert.equal(client.lifecycle.get().error?.code, 'CONFIGURATION');
    assert.equal(issues.at(-1)?.source, 'connection');
    assert.equal(issues.at(-1)?.recoverable, false);
    assert.deepEqual(lifecycle.filter(snapshot => snapshot.status === 'error').map(snapshot => snapshot.error?.code), ['CONFIGURATION']);
    await client.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('generated application definition mismatches fail once with a distinct permanent error', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests += 1;
    assert.equal(JSON.parse(options.body).applicationRevision, 'revision-old');
    return {
      ok: false,
      status: 409,
      async json() {
        return {
          code: 'APPLICATION_DEFINITION_MISMATCH',
          error: 'Regenerate this application binding.'
        };
      }
    };
  };
  globalThis.WebSocket = class {};
  try {
    const client = createClient({
      clientId: 'outdated_app',
      applicationRevision: 'revision-old',
      retry: { maxAttempts: 5, initialDelay: 0, maxDelay: 0 }
    });
    await assert.rejects(
      client.open(),
      error => error?.code === 'APPLICATION_DEFINITION_MISMATCH' && error?.status === 409
    );
    assert.equal(requests, 1);
    assert.equal(client.lifecycle.get().error?.message, 'Regenerate this application binding.');
    await client.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('one failing state listener cannot block other consumers', async () => {
  const reported = [];
  const issues = [];
  const client = createClient({ clientId: 'safe_app', demo: true });
  client.on('issue', ({ error }) => reported.push(error));
  client.on('issue', issue => issues.push(issue));
  client.state.subscribe(state => { if (state) throw new Error('consumer failed'); });
  let delivered = false;
  client.state.subscribe(() => { delivered = true; });
  await client.open();
  assert.equal(delivered, true);
  assert.equal(reported[0]?.message, 'consumer failed');
  assert.equal(issues[0]?.source, 'listener');
  assert.equal(issues[0]?.recoverable, true);
  assert.equal(client.lifecycle.get().error, null);
  await client.disconnect();
});

test('rejected async listeners are forwarded without becoming unhandled rejections', async () => {
  const reported = [];
  const client = createClient({ clientId: 'safe_app', demo: true });
  client.on('issue', ({ error }) => reported.push(error));
  client.state.subscribe(async state => { if (state) throw new Error('async state listener failed'); });
  client.on('status', async status => {
    if (status === 'connected') throw new Error('async event listener failed');
  });
  await client.open();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(reported.map(error => error.message), [
    'async state listener failed',
    'async event listener failed'
  ]);
  await client.disconnect();
});

test('custom transports cannot inject non-JSON state values', async () => {
  const client = createClient({
    clientId: 'safe_app',
    transport: {
      name: 'unsafe-test',
      async open(context) {
        context.onMessage({
          version: PROTOCOL_VERSION,
          sequence: 1,
          type: 'state.snapshot',
          data: { capabilities: [], gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 0, mode: 'none' }, players: [], extension: new Date() }
        });
      }
    }
  });
  const errors = [];
  client.on('issue', ({ error }) => errors.push(error));
  await client.open();
  assert.equal(client.state.get(), null);
  assert.equal(errors[0]?.code, 'INVALID_MESSAGE');
});

test('host bridge opens app-owned windows after an authenticated platform connection', async () => {
  const original = {
    window: globalThis.window,
    location: globalThis.location,
    document: globalThis.document,
    sessionStorage: globalThis.sessionStorage
  };
  const messages = [];
  const listeners = new Set();
  const storage = new Map();
  const host = { postMessage(message, origin) { messages.push({ message, origin }); } };
  globalThis.window = {
    parent: host,
    opener: null,
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); }
  };
  globalThis.location = { search: '?w3surface=application', hash: '#w3session=launch-session', origin: 'http://localhost:8082' };
  globalThis.document = { referrer: 'https://app.w3booster.com/apps' };
  globalThis.sessionStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); }
  };
  try {
    const client = createClient({ clientId: 'test_app', transport: { name: 'authenticated-test', open() {} } });
    const hostSnapshots = [];
    client.host.lifecycle.subscribe(snapshot => hostSnapshots.push(snapshot));
    assert.equal(client.host.available, false);
    assert.equal(client.host.lifecycle.get().available, false);
    assert.equal(client.host.capabilityStatus, 'unavailable');
    assert.equal(client.host.can('window:open'), false);
    await client.open();
    assert.equal(client.host.available, true);
    assert.equal(client.host.capabilityStatus, 'pending');
    assert.equal(client.host.lifecycle.get().capabilityStatus, 'pending');
    assert.equal(client.host.can('window:open'), false);
    await Promise.resolve();
    const automaticCapabilities = messages.find(entry => entry.message.command === 'host.capabilities.get');
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: automaticCapabilities.message.requestId, ok: true,
        value: { capabilities: ['window:open', 'settings:write'] }
      }
    });
    await Promise.resolve();
    messages.length = 0;
    assert.equal(client.host.capabilityStatus, 'known');
    assert.equal(client.host.lifecycle.get().capabilityStatus, 'known');
    assert.deepEqual(hostSnapshots.map(snapshot => snapshot.capabilityStatus), ['unavailable', 'pending', 'known']);
    assert.equal(client.host.supports('window:open'), true);
    assert.equal(client.host.can('window:open'), true);
    assert.equal(client.host.can('window:close'), false);
    const acknowledge = async (operation, value = { accepted: true }) => {
      const request = messages.at(-1).message;
      for (const listener of listeners) listener({
        source: host,
        origin: 'https://app.w3booster.com',
        data: {
          source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
          requestId: request.requestId, ok: true, value
        }
      });
      return await operation;
    };
    const opened = client.host.openWindow({ path: '?view=compact', width: 500 });
    assert.deepEqual(messages[0].message.options, { path: '?view=compact', width: 500 });
    assert.equal(messages[0].message.type, 'host.open-window');
    assert.equal(messages[0].origin, 'https://app.w3booster.com');
    assert.equal(await acknowledge(opened), undefined);
    const saved = client.host.setSetting('layout', 'wide');
    assert.deepEqual(messages[1].message, {
      source: 'w3booster-sdk',
      clientId: 'test_app',
      type: 'host.command',
      command: 'application.settings.set',
      payload: { path: 'layout', value: 'wide' },
      requestId: messages[1].message.requestId
    });
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://attacker.test',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: messages[1].message.requestId, ok: true, value: { settings: { layout: 'spoofed' } }
      }
    });
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: messages[1].message.requestId, ok: true, value: { settings: { layout: 'wide' } }
      }
    });
    assert.deepEqual(await saved, { layout: 'wide' });

    const firstSettingWrite = client.host.setSetting('observer', { layout: 'first' });
    const firstSettingMessage = messages.at(-1).message;
    const secondSettingWrite = client.host.setSetting('observer.layout', 'second');
    assert.equal(messages.at(-1).message.requestId, firstSettingMessage.requestId);
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: firstSettingMessage.requestId, ok: true, value: { settings: { observer: { layout: 'first' } } }
      }
    });
    assert.deepEqual(await firstSettingWrite, { observer: { layout: 'first' } });
    await Promise.resolve();
    const secondSettingMessage = messages.at(-1).message;
    assert.notEqual(secondSettingMessage.requestId, firstSettingMessage.requestId);
    assert.equal(secondSettingMessage.payload.value, 'second');
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: secondSettingMessage.requestId, ok: true, value: { settings: { observer: { layout: 'second' } } }
      }
    });
    assert.deepEqual(await secondSettingWrite, { observer: { layout: 'second' } });

    const parsedCommand = client.host.command('example.parsed', undefined, {
      parse: value => {
        if (!value || typeof value !== 'object' || value.accepted !== true) throw new TypeError('invalid acknowledgement');
        return value.accepted;
      }
    });
    assert.equal(await acknowledge(parsedCommand, { accepted: true }), true);

    await acknowledge(client.host.command('example.command', { enabled: true }));
    await acknowledge(client.host.command('example.reset'));
    await acknowledge(client.host.closeWindow());
    const capabilities = client.host.refreshCapabilities();
    const capabilityMessage = messages.at(-1).message;
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: capabilityMessage.requestId, ok: true,
        value: { capabilities: ['window:open', 'settings:write', 'unsupported'] }
      }
    });
    assert.deepEqual(await capabilities, ['window:open', 'settings:write']);
    assert.equal(client.host.supports('window:open'), true);
    assert.equal(client.host.supports('window:close'), false);
    const invalidCapabilities = client.host.refreshCapabilities();
    const invalidCapabilityMessage = messages.at(-1).message;
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: invalidCapabilityMessage.requestId, ok: true,
        value: { capabilities: 'invalid' }
      }
    });
    await assert.rejects(invalidCapabilities, /invalid capabilities/);
    assert.equal(client.host.capabilityStatus, 'unavailable');
    assert.deepEqual(client.host.capabilities, []);
    const acknowledgedWindow = client.host.openWindow({ path: '?view=compact' });
    const windowMessage = messages.at(-1).message;
    assert.equal(windowMessage.type, 'host.open-window');
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: windowMessage.requestId, ok: true, value: { opened: true }
      }
    });
    assert.equal(await acknowledgedWindow, undefined);
    const actionLifetime = new AbortController();
    const cancelledWindow = client.host.openWindow(
      { path: '?view=cancelled' },
      { signal: actionLifetime.signal, timeout: 1000 }
    );
    const cancelledRequest = messages.at(-1).message;
    actionLifetime.abort();
    await assert.rejects(cancelledWindow, error => error?.name === 'AbortError');
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: cancelledRequest.requestId, ok: true, value: { opened: true }
      }
    });
    const timedOutWindow = client.host.closeWindow({ timeout: 5 });
    await assert.rejects(timedOutWindow, error => error?.code === 'HOST_TIMEOUT');
    assert.throws(() => client.host.setSetting('invalid..path', true), TypeError);
    assert.throws(() => client.host.setSetting('layout', () => {}), /JSON-compatible/);
    await client.disconnect();
    assert.equal(client.host.available, false);
    assert.equal(client.host.capabilityStatus, 'unavailable');
    assert.equal(client.host.can('window:open'), false);
    assert.equal(listeners.size, 0);

    globalThis.location.hash = '';
    const reloaded = createClient({ clientId: 'test_app', transport: { name: 'reload-test', open() {} } });
    await reloaded.open();
    assert.equal(reloaded.host.available, true);
    await Promise.resolve();
    const legacyCapabilities = messages.at(-1).message;
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: legacyCapabilities.requestId, ok: false,
        error: { code: 'UNKNOWN_COMMAND', message: 'Unsupported command' }
      }
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(reloaded.host.capabilityStatus, 'unavailable');
    assert.equal(reloaded.host.can('window:open'), false);
    await reloaded.disconnect();

    const unavailable = createClient({ clientId: 'test_app', transport: { name: 'unavailable-host-test', open() {} } });
    await unavailable.open();
    await Promise.resolve();
    const failedCapabilities = messages.at(-1).message;
    for (const listener of listeners) listener({
      source: host,
      origin: 'https://app.w3booster.com',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: failedCapabilities.requestId, ok: false,
        error: { code: 'HOST_BUSY', message: 'Try again later' }
      }
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(unavailable.host.capabilityStatus, 'unavailable');
    assert.equal(unavailable.host.can('window:open'), false);
    await unavailable.disconnect();

    globalThis.document.referrer = 'https://attacker.test/frame';
    const moved = createClient({ clientId: 'test_app', transport: { name: 'moved-test', open() {} } });
    await moved.open();
    assert.equal(moved.host.available, false);
    await moved.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('unrelated parent windows are not reported as the W3Booster host', async () => {
  const original = { window: globalThis.window, location: globalThis.location };
  const messages = [];
  globalThis.window = { parent: { postMessage(message) { messages.push(message); } }, opener: null };
  globalThis.location = { search: '', hash: '' };
  try {
    const client = createClient({ clientId: 'test_app', transport: { name: 'test', open() {} } });
    await client.open();
    assert.equal(client.host.available, false);
    await assert.rejects(client.host.command('review'), error => error?.code === 'HOST_UNAVAILABLE');
    assert.deepEqual(messages, []);
    await client.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('embedded apps report their document height to the W3Booster host', async () => {
  const original = {
    window: globalThis.window,
    location: globalThis.location,
    document: globalThis.document,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  const messages = [];
  const host = { postMessage(message, origin) { messages.push({ message, origin }); } };
  globalThis.window = { parent: host, opener: null };
  globalThis.location = { search: '?w3surface=application', hash: '#w3session=launch-session' };
  globalThis.document = {
    readyState: 'complete',
    referrer: 'https://app.w3booster.com/apps',
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
    const client = createClient({ clientId: 'test_app', transport: { name: 'authenticated-test', open() {} } });
    await client.open();
    const resize = messages.find(entry => entry.message.type === 'host.resize');
    assert.equal(resize.message.height, 720);
    assert.equal(resize.origin, 'https://app.w3booster.com');
    await client.disconnect();
    messages.length = 0;
    const fixedHeightClient = createClient({
      clientId: 'test_app',
      autoResize: false,
      transport: { name: 'authenticated-test', open() {} }
    });
    await fixedHeightClient.open();
    assert.equal(messages.some(entry => entry.message.type === 'host.resize'), false);
    await fixedHeightClient.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('stopping auto resize cancels deferred DOM setup', async () => {
  const original = {
    window: globalThis.window,
    location: globalThis.location,
    document: globalThis.document,
    ResizeObserver: globalThis.ResizeObserver
  };
  const listeners = new Set();
  let observerCreations = 0;
  globalThis.window = { parent: { postMessage() {} }, opener: null };
  globalThis.location = { search: '?w3surface=application', hash: '#w3session=launch-session' };
  globalThis.document = {
    readyState: 'loading',
    addEventListener(type, listener) { if (type === 'DOMContentLoaded') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'DOMContentLoaded') listeners.delete(listener); }
  };
  globalThis.ResizeObserver = class {
    constructor() { observerCreations += 1; }
    observe() {}
    disconnect() {}
  };
  try {
    const client = createClient({ clientId: 'test_app', transport: { name: 'authenticated-test', open() {} } });
    await client.open();
    assert.equal(listeners.size, 1);
    const deferredSetup = [...listeners][0];
    client.host.stopAutoResize();
    assert.equal(listeners.size, 0);
    deferredSetup();
    assert.equal(observerCreations, 0);
    await client.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('demo transport gives developers hydrated state', async () => {
  const client = await openClient({ clientId: 'test_app', demo: { interval: 10, settings: { layout: 'wide' } } });
  assert.equal(client.status, 'connected');
  assert.equal(client.diagnostics.transport, 'demo');
  assert.equal(client.state.get().match.status, 'running');
  assert.equal(client.state.get().application.clientId, 'test_app');
  assert.equal(client.state.get().application.settings.layout, 'wide');
  assert.equal(client.state.get().gameContext.hudScale, 1);
  assert.ok(client.state.get().capabilities.includes('controlgroups'));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(client.state.get().match.gameTime >= 1);
  await client.disconnect();
});

test('demo overlay extensions reject SDK-owned branches at runtime', () => {
  for (const key of ['runtime', 'misc', 'settings']) {
    assert.throws(
      () => createDemoState({ overlayExtensions: { [key]: { custom: true } } }),
      new RegExp(`SDK-owned ${key} branch`)
    );
  }
});

test('demo transport safely animates valid custom states without player resources', async () => {
  const client = await openClient({
    clientId: 'demo_custom',
    demo: {
      interval: 1,
      state: {
        capabilities: ['match'],
        gameContext: { hudScale: 1 }, match: { id: 'custom', status: 'running', gameTime: 0, mode: 'custom' },
        players: []
      }
    }
  });
  try {
    const state = await new Promise(resolve => {
      const unsubscribe = client.state.subscribe(current => {
        if (current.match.gameTime < 1) return;
        unsubscribe();
        resolve(current);
      });
    });
    assert.equal(state.match.gameTime, 1);
    assert.deepEqual(state.players, []);
  } finally {
    await client.disconnect();
  }
});

test('a zero demo interval provides a static deterministic frontend fixture', async () => {
  const client = await openClient({ clientId: 'demo_static', demo: { interval: 0 } });
  const initial = client.state.get();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(client.state.get(), initial);
  assert.equal(client.state.get().match.gameTime, 0);
  await client.disconnect();
  await assert.rejects(openClient({ clientId: 'demo_invalid', demo: { interval: -1 } }), /non-negative/);
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
        data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
      }));
    },
    close() {}
  };
  const client = createClient({ clientId: 'test_app', transport });
  await client.open();
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
  const client = createClient({ clientId: 'test_app', transport });
  let publications = 0;
  client.state.subscribe(() => { publications += 1; });
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 4 },
    players: [{ id: '0', name: 'Stable' }],
    overlay: { futureExtension: { layout: 'wide' } },
    transport: { recorderUrls: ['ws://127.0.0.1:48123'] },
    extension: { stable: true }
  } });
  const previous = client.state.get();
  assert.equal(previous.overlay.settings, undefined);
  assert.deepEqual(previous.overlay.futureExtension, { layout: 'wide' });
  assert.equal(Object.isFrozen(previous.overlay.futureExtension), true);
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 5 }] });
  const current = client.state.get();
  assert.equal(current.match.gameTime, 5);
  assert.notEqual(current.match, previous.match);
  assert.equal(current.players, previous.players);
  assert.equal(current.players[0], previous.players[0]);
  assert.equal(current.overlay, previous.overlay);
  assert.equal(current.gameContext, previous.gameContext);
  assert.equal(current.extension, previous.extension);
  assert.equal(publications, 3);
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 5 }] });
  assert.equal(client.state.get(), current);
  assert.equal(publications, 3);
});

test('public game context and demo extensions remain immutable', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'public-shape', open(value) { context = value; }, close() {} }
  });
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],  match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' },
    players: [],
    gameContext: { hudScale: 0.75, teamColors: true }
  } });
  assert.deepEqual(client.state.get().gameContext, { hudScale: 0.75, teamColors: true });
  await client.disconnect();

  const demo = createClient({ clientId: 'test_app', demo: { interval: 0, state: { match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' },
    players: [],
    capabilities: [],
    gameContext: { hudScale: 0.75 },
    overlay: {
      tournament: { round: 4 }
    }
  } } });
  await demo.start();
  assert.equal(demo.state.get().gameContext.hudScale, 0.75);
  assert.deepEqual(demo.state.get().overlay.tournament, { round: 4 });
  await demo.disconnect();
});

test('map names are decoded once at snapshot and patch ingress', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', open(value) { context = value; }, close() {} }
  });
  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  map: 'Echo%2520Isles', gameTime: 1 }, players: [] }
  });
  assert.equal(client.state.get().match.map, 'Echo%20Isles');

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'state.patch',
    data: [{ op: 'replace', path: '/match/gameTime', value: 2 }]
  });
  assert.equal(client.state.get().match.map, 'Echo%20Isles');

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 3,
    type: 'state.patch',
    data: [{ op: 'replace', path: '/match/map', value: 'Turtle%20Rock' }]
  });
  assert.equal(client.state.get().match.map, 'Turtle Rock');
  await client.disconnect();
});

test('replace patches require an existing object property', async () => {
  let context;
  const errors = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; }, resync() {} }
  });
  client.on('issue', ({ error }) => errors.push(error));
  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 4 }, players: [] }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'state.patch',
    data: [{ op: 'replace', path: '/match/map', value: 'Echo Isles' }]
  });
  assert.equal(client.state.get().match.map, undefined);
  assert.equal(errors[0]?.code, 'INVALID_PATCH');
  await client.disconnect();
});

test('hydrated changes emit useful player, hero, inventory, and match events', async () => {
  let context;
  const transport = { name: 'test', async open(value) { context = value; } };
  const client = createClient({ clientId: 'test_app', transport });
  await client.open();
  const events = [];
  client.on('player.resources.changed', event => events.push(['resources', event]));
  client.on('hero.changed', event => events.push(['hero', event]));
  client.on('hero.inventory.changed', event => events.push(['inventory', event]));
  client.on('match.ended', event => events.push(['ended', event]));

  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {
    capabilities: ['match', 'players', 'heroes', 'resources'],
    gameContext: { hudScale: 1 }, match: { id: 'one', status: 'running', gameTime: 10, mode: '1v1' },
    players: [{ id: '0', name: 'Player', resources: { gold: 100, lumber: 0, supply: 0, supplyCap: 0 }, heroes: [{ id: 'Hamg', name: 'Archmage', level: 1, inventory: ['ratf'] }] }]
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [
    { op: 'replace', path: '/players/0/resources/gold', value: 125 },
    { op: 'replace', path: '/players/0/heroes/0/level', value: 2 },
    { op: 'add', path: '/players/0/heroes/0/inventory/-', value: 'rin1' },
    { op: 'replace', path: '/match/status', value: 'finished' },
    { op: 'add', path: '/match/endedAt', value: '2026-08-19T00:30:00.000Z' }
  ] });

  assert.equal(client.state.player('0').resources.gold, 125);
  assert.equal(events.find(([type]) => type === 'resources')[1].previousResources.gold, 100);
  assert.deepEqual(events.find(([type]) => type === 'inventory')[1].inventory, ['ratf', 'rin1']);
  assert.ok(events.find(([type]) => type === 'hero')[1].changedFields.includes('level'));
  const ended = events.find(([type]) => type === 'ended')[1];
  assert.equal(ended.match.id, 'one');
  assert.equal(ended.match.status, 'finished');
  assert.equal(ended.match.endedAt, '2026-08-19T00:30:00.000Z');
  assert.equal(ended.previousMatch.status, 'running');
  assert.equal(Number.isFinite(Date.parse(ended.observedAt)), true);
});

test('event payloads are immutable and cannot be changed for later listeners', async () => {
  let context;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  const observed = [];
  client.on('match.changed', event => {
    assert.equal(Object.isFrozen(event), true);
    assert.equal(Object.isFrozen(event.changedFields), true);
    assert.throws(() => event.changedFields.push('injected'), TypeError);
  });
  client.on('match.changed', event => observed.push([...event.changedFields]));
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: { id: 'one', status: 'running', gameTime: 1, mode: '1v1' }, players: []
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [
    { op: 'replace', path: '/match/gameTime', value: 2 }
  ] });
  assert.deepEqual(observed, [['gameTime']]);
  await client.disconnect();
});

test('unknown protocol events require an explicit unknown-event subscription', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  const wildcardEvents = [];
  const extensionEvents = [];
  const statuses = [];
  const sharedEvents = [];
  const knownController = new AbortController();
  const sharedListener = data => sharedEvents.push(data);
  client.on('*', event => wildcardEvents.push(event));
  client.on('status', status => statuses.push(status));
  client.on('status', sharedListener, { signal: knownController.signal });
  client.onUnknown('status', sharedListener);
  client.onUnknown('extension.notice', data => extensionEvents.push(data));
  client.onUnknown('status', data => extensionEvents.push(data));
  await client.open();
  wildcardEvents.length = 0;
  statuses.length = 0;
  sharedEvents.length = 0;
  knownController.abort();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'extension.notice',
    data: { message: 'ready' }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'status',
    data: { extension: true }
  });

  assert.deepEqual(wildcardEvents, []);
  assert.deepEqual(statuses, []);
  assert.deepEqual(sharedEvents, [{ extension: true }]);
  assert.deepEqual(extensionEvents, [{ message: 'ready' }, { extension: true }]);
  await client.disconnect();
});

test('the initial snapshot establishes a baseline before domain transition events', async () => {
  let context;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  const events = [];
  const observations = [];
  client.on('state.ready', () => events.push('ready'));
  client.on('match.started', event => events.push(`started:${event.match.id}`));
  client.on('match.ended', event => events.push(`ended:${event.match.id}`));
  client.subscribeMatchLifecycle(event => observations.push(event));
  await client.open();

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'existing', status: 'running', gameTime: 10, mode: '1v1' }, players: [] }
  });
  assert.deepEqual(events, ['ready']);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].phase, 'started');
  assert.equal(observations[0].initial, true);
  assert.equal(observations[0].match.id, 'existing');

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'next', status: 'running', gameTime: 0, mode: '1v1' }, players: [] }
  });
  assert.deepEqual(observations.slice(1).map(event => [event.phase, event.initial, event.match.id]), [
    ['ended', false, 'existing'], ['started', false, 'next']
  ]);
  assert.deepEqual(events, ['ready', 'ended:existing', 'started:next']);

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 3,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: {
        id: 'next', status: 'finished', gameTime: 60, mode: '1v1',
        endedAt: '2026-08-19T00:31:00.000Z'
      },
      players: []
    }
  });
  assert.equal(observations.at(-1).phase, 'ended');
  assert.equal(observations.at(-1).match.endedAt, '2026-08-19T00:31:00.000Z');
  assert.equal(observations.at(-1).previousMatch.status, 'running');
  await client.disconnect();
});

test('match lifecycle can opt into the current finished match without changing its default', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  const defaultObservations = [];
  const terminalObservations = [];
  client.subscribeMatchLifecycle(event => defaultObservations.push(event));
  client.subscribeMatchLifecycle(event => terminalObservations.push(event), { includeCurrentFinished: true });
  await client.open();

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: {
        id: 'completed-before-hydration', status: 'finished', gameTime: 60, mode: '1v1',
        endedAt: '2026-08-19T00:31:00.000Z'
      },
      players: []
    }
  });

  assert.deepEqual(defaultObservations, []);
  assert.deepEqual(terminalObservations.map(event => [event.phase, event.initial, event.match.id]), [
    ['ended', true, 'completed-before-hydration']
  ]);
  assert.equal(terminalObservations[0].match.endedAt, '2026-08-19T00:31:00.000Z');
  assert.equal(terminalObservations[0].previousMatch, undefined);
  assert.throws(
    () => client.subscribeMatchLifecycle(() => {}, { includeCurrentFinished: 'yes' }),
    /includeCurrentFinished must be a boolean/
  );
  await client.disconnect();
});

test('match lifecycle subscriptions created during a state transition report it exactly once', async () => {
  let context;
  let unsubscribeLifecycle;
  const observations = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.state.subscribe(state => {
    if (state?.match.status === 'running' && !unsubscribeLifecycle) {
      unsubscribeLifecycle = client.subscribeMatchLifecycle(event => observations.push(event));
    }
  });
  await client.open();

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'reentrant', status: 'running', gameTime: 0, mode: '1v1' }, players: [] }
  });

  assert.deepEqual(observations.map(event => [event.phase, event.initial, event.match.id]), [
    ['started', true, 'reentrant']
  ]);
  unsubscribeLifecycle?.();
  await client.disconnect();
});

test('watch publishes unavailable state and only runs when its selected value changes', async () => {
  const storeChanges = [];
  let context;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.open();
  client.state.watch(state => state?.match.map ?? null, (map, previous) => storeChanges.push([map, previous]));
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  map: 'A', gameTime: 1 }, players: [] } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 2 }] });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/map', value: 'B' }] });
  await client.disconnect();
  assert.deepEqual(storeChanges, [[null, undefined], ['A', null], ['B', 'A'], [null, 'B']]);
});

test('watch supports an explicit structural comparator', async () => {
  const storeChanges = [];
  let context;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.open();
  client.state.watch(state => state?.application?.settings, settings => storeChanges.push(settings), {
    equals: (left, right) => left?.first === right?.first && left?.second === right?.second
  });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 1 }, players: [], application: { clientId: 'test_app', settings: { first: 1, second: 2 } }
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 1 }, players: [], application: { clientId: 'test_app', settings: { second: 2, first: 1 } }
  } });
  assert.deepEqual(storeChanges, [undefined, { first: 1, second: 2 }]);
  await client.disconnect();
});

test('watch defaults to immutable identity and accepts non-cloneable selections', async () => {
  const selections = [];
  const selected = () => 'selection';
  let context;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', open(value) { context = value; } } });
  client.state.watch(() => selected, value => selections.push(value));
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 1 }, players: [] } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 2 }, players: [] } });
  assert.deepEqual(selections, [selected]);
  await client.disconnect();
});

test('application settings stay in state and emit a domain event', async () => {
  let context;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.open();
  let change;
  client.on('application.settings.changed', event => { change = event; });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [],
    application: { clientId: 'test_app', settings: { layout: 'compact' } }
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.patch', data: [
    { op: 'replace', path: '/application/settings/layout', value: 'wide' }
  ] });
  assert.equal(client.state.get().application.settings.layout, 'wide');
  assert.equal(change.previousSettings.layout, 'compact');
  assert.equal(change.settings.layout, 'wide');

  context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.patch', data: [
    { op: 'remove', path: '/application' }
  ] });
  assert.equal(change.previousSettings.layout, 'wide');
  assert.equal(change.settings, undefined);
});

test('canonical upgrade rawcodes and explicit levels are preserved at state ingress', async () => {
  let context;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
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
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.on('issue', ({ error }) => errors.push(error));
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
    players: [{ id: '0', heroes: [{ id: 'Hamg', name: 'Archmage', level: 1, items: ['ratf'] }] }]
  } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: {capabilities: [],
    gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
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
  const client = createClient({
    clientId: 'match_vision',
    transport: { name: 'cloud-test', async open(value) { context = value; } }
  });
  const publicEvents = [];
  client.on('*', event => publicEvents.push(event));
  let publications = 0;
  client.state.subscribe(() => { publications += 1; });
  try {
    await client.open();
    const baseline = {
      capabilities: ['match', 'players', 'heroes', 'upgrades', 'resources', 'controlgroups'],
      gameContext: { hudScale: 1 }, match: {
        id: 'observer-match', status: 'running', gameTime: 1, mode: '1v1', isObserver: true,
        broadcasterPlayerId: '0', realBroadcasterPlayerId: '0'
      },
      players: [{
        id: '0',
        heroes: [{
          id: 'Edem', name: 'Demon Hunter', level: 1, experience: 0,
          platformMetadata: { portrait: 'demon-hunter' }, hitpoints: { current: 400, max: 500 }
        }],
        upgrades: { upgrades: [], active: [], researching: [] }
      }, {
        id: '1', name: 'Unchanged player', heroes: [],
        upgrades: { upgrades: [], active: [], researching: [] }
      }],
      transport: { recorderUrls: ['ws://127.0.0.1:48123'] },
      application: { clientId: 'match_vision', settings: {} }
    };
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: baseline });

    await waitForDeferredModule(() => sockets.length === 1);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].url, 'ws://127.0.0.1:48123/');
    const authenticatedState = client.state.get();
    assert.equal(authenticatedState.transport, undefined);
    assert.equal(publicEvents.some(event => event.type === 'state.snapshot' || event.type === 'state.patch'), false);
    assert.equal(JSON.stringify(publicEvents).includes('48123'), false);
    context.onMessage({
      version: PROTOCOL_VERSION,
      sequence: 2,
      type: 'state.patch',
      data: [{ op: 'replace', path: '/transport/recorderUrls', value: ['ws://127.0.0.1:48123'] }]
    });
    assert.equal(publications, 2, 'control-plane-only patches do not republish public state');
    sockets[0].emit('open');
    sockets[0].emit('message', JSON.stringify([
      { class: 'W3GameTime', matchId: 'observer-match', value: 12 },
      { class: 'W3HudScale', matchId: 'observer-match', value: 70 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 1, value: 1230 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 2, value: 670 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 5, value: 31 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 4, value: 50 }
    ]));
    sockets[0].emit('message', JSON.stringify([
      { class: 'W3Unit', matchId: 'observer-match', slotId: 0, type: 'Edmm', isHero: true, experience: 500,
        abilities: [{ type: 'AUfa', level: 2, order: 1, lastActivation: 9000 }], inventory: ['ratf'] },
      { class: 'W3Research', matchId: 'observer-match', slotId: 0, type: 'Rema', level: 2 }
    ]));
    assert.equal(client.state.get(), authenticatedState);
    await waitForRecorderFrame();

    let state = client.state.get();
    assert.equal(publications, 3);
    assert.equal(state.application, authenticatedState.application);
    assert.equal(state.players[1], authenticatedState.players[1]);
    assert.equal(state.players[0].heroes[0].platformMetadata, authenticatedState.players[0].heroes[0].platformMetadata);
    assert.equal(state.players[0].heroes[0].hitpoints, authenticatedState.players[0].heroes[0].hitpoints);
    assert.equal(client.diagnostics.localTransport, 'recorder-local');
    assert.equal(state.match.gameTime, 12);
    assert.equal(state.gameContext.hudScale, 0.75);
    assert.deepEqual(state.players[0].resources, { gold: 123, lumber: 67, supply: 31, supplyCap: 50, workerSupply: 0 });
    assert.equal(state.players[0].heroes[0].id, 'Edem');
    assert.equal(state.players[0].heroes[0].name, 'Demon Hunter');
    assert.equal(state.players[0].heroes[0].level, 3);
    assert.equal(state.players[0].heroes[0].abilities[0].name, 'AUfu');
    assert.deepEqual(state.players[0].heroes[0].inventory, ['ratf']);
    assert.deepEqual(state.players[0].heroes[0].platformMetadata, { portrait: 'demon-hunter' });
    assert.deepEqual(state.players[0].heroes[0].hitpoints, { current: 400, max: 500 });
    assert.equal(state.players[0].upgrades.active[0].level, 2);

    const updatedState = state;
    sockets[0].emit('message', JSON.stringify([
      { class: 'W3GameTime', matchId: 'observer-match', value: 12 },
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 1, value: 1230 }
    ]));
    await waitForRecorderFrame();
    assert.equal(client.state.get(), updatedState);
    assert.equal(publications, 3);

    // A cloud resnapshot remains the authenticated baseline, but it must not
    // erase recorder values already received through the local recorder feed.
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.snapshot', data: baseline });
    state = client.state.get();
    assert.equal(state.gameContext.hudScale, 0.75);
    assert.equal(state.players[0].resources.gold, 123);
    assert.equal(state.players[0].heroes[0].id, 'Edem');

    context.onMessage({ version: PROTOCOL_VERSION, sequence: 4, type: 'state.patch', data: [{ op: 'replace', path: '/match/status', value: 'finished' }] });
    assert.equal(client.diagnostics.localTransport, null);
  } finally {
    await client.disconnect();
    if (originalWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWebSocket;
  }
});

test('local hero abilities omit unused and non-finite activation timestamps', () => {
  const baseline = {
    capabilities: ['match', 'players', 'heroes'], gameContext: { hudScale: 1 },
    match: { id: 'replay', status: 'running', gameTime: 1, mode: '1v1', isReplay: true },
    players: [{ id: '0', heroes: [] }]
  };
  for (const lastActivation of [undefined, 0, -1, Infinity, NaN]) {
    const state = applyLocalRecorderUpdates(baseline, [{
      class: 'W3Unit', slotId: 0, type: 'Hamg', isHero: true,
      abilities: [{ type: 'AHwe', level: 1, lastActivation }]
    }]);
    assert.equal(Object.hasOwn(state.players[0].heroes[0].abilities[0], 'lastActivation'), false);
  }
});

test('replay heroes retain appearance order and exact inventory slots through cache reapplication', async () => {
  const originalWebSocket = globalThis.WebSocket;
  let socket;
  globalThis.WebSocket = class FakeWebSocket {
    constructor() { this.listeners = new Map(); socket = this; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, data) { this.listeners.get(type)?.(data === undefined ? {} : { data }); }
    close() {}
  };
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'cloud-test', async open(value) { context = value; } }
  });
  const baseline = {
    capabilities: ['match', 'players', 'heroes'], gameContext: { hudScale: 1 },
    match: { id: 'replay', status: 'running', gameTime: 1, mode: '1v1', isReplay: true },
    players: [{ id: '0', heroes: [] }],
    transport: { recorderUrls: ['ws://127.0.0.1:48123'] },
    application: { clientId: 'test_app', settings: {} }
  };
  let sequence = 0;
  const resnapshot = () => context.onMessage({
    version: PROTOCOL_VERSION, sequence: ++sequence, type: 'state.snapshot', data: baseline
  });
  const hero = (type, inventory) => ({
    class: 'W3Unit', matchId: 'replay', slotId: 0, type, isHero: true, inventory
  });
  const inventory = ['ratf', '', 'ratf', 'rin1', '', 'rde1'];
  const movedInventory = ['', 'rin1', 'ratf', '', 'ratf', 'rde1'];
  const assertHeroes = (ids, items) => {
    const heroes = client.state.get().players[0].heroes;
    assert.deepEqual(heroes.map(value => value.id), ids);
    assert.deepEqual(heroes[0].inventory, items);
  };
  try {
    await client.open();
    resnapshot();
    await waitForDeferredModule(() => socket !== undefined);
    socket.emit('open');
    socket.emit('message', JSON.stringify([
      hero('Edem', []), hero('Ekee', []), hero('Edem', inventory)
    ]));
    await waitForRecorderFrame();
    assertHeroes(['Edem', 'Ekee'], inventory);
    resnapshot();
    assertHeroes(['Edem', 'Ekee'], inventory);

    // A transformed hero is the same hero; later inventory updates must not
    // move it behind a newer hero or reapply an older form's item slots.
    socket.emit('message', JSON.stringify([hero('Emoo', []), hero('Edmm', movedInventory)]));
    await waitForRecorderFrame();
    assertHeroes(['Edem', 'Ekee', 'Emoo'], movedInventory);
    resnapshot();
    assertHeroes(['Edem', 'Ekee', 'Emoo'], movedInventory);
    socket.emit('message', JSON.stringify([hero('Ekee', ['rin1']), hero('Edem', inventory)]));
    await waitForRecorderFrame();
    resnapshot();
    assertHeroes(['Edem', 'Ekee', 'Emoo'], inventory);

    // First appearance belongs to one match, not to a previous replay.
    baseline.match.id = 'next-replay';
    resnapshot();
    socket.emit('open');
    socket.emit('message', JSON.stringify([
      { ...hero('Ekee', []), matchId: 'next-replay' },
      { ...hero('Edem', []), matchId: 'next-replay' }
    ]));
    await waitForRecorderFrame();
    assertHeroes(['Ekee', 'Edem'], []);
  } finally {
    await client.disconnect();
    if (originalWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWebSocket;
  }
});

test('the local recorder rotates URLs when a socket never opens', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const sockets = [];
  const timers = new Map();
  let nextTimer = 1;
  globalThis.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  const runTimer = delay => {
    const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `Expected a ${delay}ms timer.`);
    timers.delete(entry[0]);
    entry[1].callback();
  };
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      sockets.push(this);
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    close() { this.closed = true; this.listeners.get('close')?.({}); }
  };
  let stream;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'cloud-test', async open(value) { stream = value; } }
  });
  try {
    await client.open();
    stream.onMessage({
      version: PROTOCOL_VERSION,
      sequence: 1,
      type: 'state.snapshot',
      data: {
        capabilities: ['match', 'players'],
        gameContext: { hudScale: 1 }, match: { id: 'observer-match', status: 'running', gameTime: 1, mode: '1v1', isObserver: true },
        players: [],
        transport: { recorderUrls: ['ws://127.0.0.1:48123', 'ws://127.0.0.1:48124'] },
        application: { clientId: 'test_app', settings: {} }
      }
    });
    await waitForDeferredModule(() => sockets.length === 1);
    assert.equal(sockets[0].url, 'ws://127.0.0.1:48123/');
    runTimer(5000);
    assert.equal(sockets[0].closed, true);
    runTimer(250);
    assert.equal(sockets[1].url, 'ws://127.0.0.1:48124/');
  } finally {
    await client.disconnect();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
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
  const client = createClient({
    clientId: 'overlay_only',
    transport: { name: 'cloud-test', async open(value) { context = value; } }
  });
  try {
    await client.open();
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {
      capabilities: ['match', 'players'],
      gameContext: { hudScale: 1 }, match: { id: 'observer-match', status: 'running', gameTime: 1, mode: '1v1', isReplay: true },
      players: [{ id: '0' }],
      transport: { recorderUrls: ['ws://localhost:48123'] },
      application: { clientId: 'overlay_only', settings: {} }
    } });
    await waitForDeferredModule(() => socket !== undefined);
    socket.emit('open');
    socket.emit('message', JSON.stringify([
      { class: 'W3HudScale', value: 70 },
      { class: 'W3Resource', slotId: 0, type: 1, value: 9990 }
    ]));
    await waitForRecorderFrame();
    assert.equal(client.state.get().gameContext.hudScale, 0.75);
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
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'cloud-test', async open(value) { context = value; }, close() {} }
  });
  const snapshot = gold => ({
    capabilities: ['match', 'players', 'resources'],
    gameContext: { hudScale: 1 }, match: { id: 'observer-match', status: 'running', gameTime: 1, mode: '1v1', isObserver: true },
    players: [{ id: '0', resources: { gold, lumber: 0, supply: 0, supplyCap: 0 } }],
    transport: { recorderUrls: ['ws://127.0.0.1:48123'] },
    application: { clientId: 'test_app', settings: {} }
  });
  try {
    await client.open();
    context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: snapshot(100) });
    await waitForDeferredModule(() => socket !== undefined);
    socket.emit('open');
    socket.emit('message', JSON.stringify([
      { class: 'W3Resource', matchId: 'observer-match', slotId: 0, type: 1, value: 1230 }
    ]));
    await waitForRecorderFrame();
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

test('invalid local recorder updates are not cached into later platform snapshots', async () => {
  const originalWebSocket = globalThis.WebSocket;
  let socket;
  globalThis.WebSocket = class FakeWebSocket {
    constructor() { this.listeners = new Map(); socket = this; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, data) { this.listeners.get(type)?.(data === undefined ? {} : { data }); }
    close() {}
  };
  let stream;
  const errors = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'cloud-test', async open(value) { stream = value; } }
  });
  client.on('issue', ({ error }) => errors.push(error));
  const snapshot = gameTime => ({
    capabilities: ['match', 'players', 'heroes'],
    gameContext: { hudScale: 1 }, match: { id: 'observer-match', status: 'running', gameTime, mode: '1v1', isObserver: true },
    players: [{ id: '0', heroes: [{ id: 'Hamg', name: 'Archmage', level: 1 }] }],
    transport: { recorderUrls: ['ws://127.0.0.1:48123'] },
    application: { clientId: 'test_app', settings: {} }
  });
  try {
    await client.open();
    stream.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: snapshot(1) });
    await waitForDeferredModule(() => socket !== undefined);
    socket.emit('open');
    socket.emit('message', JSON.stringify([{
      class: 'W3Unit', matchId: 'observer-match', slotId: 0, type: 'Hamg', isHero: true, hitpoints: 'invalid'
    }]));
    await waitForRecorderFrame();
    assert.equal(client.state.get().players[0].heroes[0].hitpoints, undefined);
    assert.equal(errors[0]?.code, 'INVALID_STATE');

    stream.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: snapshot(2) });
    assert.equal(client.state.get().match.gameTime, 2);
    assert.equal(client.state.get().players[0].heroes[0].hitpoints, undefined);
  } finally {
    await client.disconnect();
    if (originalWebSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalWebSocket;
  }
});

test('sequence gaps request a resync instead of applying stale data', async () => {
  let context; let resyncs = 0;
  const transport = { name: 'test', async open(value) { context = value; }, resync() { resyncs++; } };
  const client = createClient({ clientId: 'test_app', transport });
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 1 }, players: [] } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 3 }] });
  assert.equal(resyncs, 1);
  assert.equal(client.state.get().match.gameTime, 1);
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 4, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 4 }] });
  assert.equal(client.state.get().match.gameTime, 1);
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 5, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 5 }, players: [] } });
  assert.equal(client.state.get().match.gameTime, 5);
  await client.disconnect();
});

test('the lifecycle store publishes synchronization-only transitions atomically', async () => {
  let context;
  const snapshots = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', open(value) { context = value; }, resync() {} }
  });
  client.lifecycle.subscribe(snapshot => snapshots.push(snapshot));
  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' }, players: [] }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 3,
    type: 'state.patch',
    data: [{ op: 'replace', path: '/match/gameTime', value: 3 }]
  });

  assert.deepEqual(snapshots.map(snapshot => [snapshot.status, snapshot.state?.match.gameTime ?? null, snapshot.isSynchronized]), [
    ['idle', null, false],
    ['connecting', null, false],
    ['connected', null, false],
    ['connected', 1, true],
    ['connected', 1, false]
  ]);
  await client.disconnect();
});

test('status transitions batch freshness and state changes into one lifecycle snapshot', async () => {
  let context;
  const snapshots = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', open(value) { context = value; }, close() {} }
  });
  client.lifecycle.subscribe(snapshot => snapshots.push(snapshot));
  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' }, players: [] }
  });

  const beforeReconnect = snapshots.length;
  context.onStatus('reconnecting');
  assert.deepEqual(snapshots.slice(beforeReconnect).map(snapshot => [snapshot.status, snapshot.isSynchronized]), [
    ['reconnecting', false]
  ]);

  const beforeDisconnect = snapshots.length;
  await client.disconnect();
  assert.deepEqual(snapshots.slice(beforeDisconnect).map(snapshot => [snapshot.status, snapshot.state, snapshot.isSynchronized]), [
    ['closed', null, false]
  ]);
});

test('openClient and connected-only startup wait for an active transport during reconnects', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', open(value) { context = value; }, close() {} }
  });
  await client.open();
  context.onStatus('reconnecting');

  let connectSettled = false;
  let startupSettled = false;
  const reconnect = client.open().finally(() => { connectSettled = true; });
  const startup = client.start({ until: 'connected' }).finally(() => { startupSettled = true; });
  await Promise.resolve();
  assert.equal(connectSettled, false);
  assert.equal(startupSettled, false);

  context.onStatus('connected');
  assert.equal(await reconnect, client);
  assert.equal(await startup, client);
  await client.disconnect();
});

test('waiting for a reconnect supports per-call cancellation', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', open(value) { context = value; }, close() {} }
  });
  await client.open();
  context.onStatus('reconnecting');
  const controller = new AbortController();
  const reconnect = client.open({ signal: controller.signal });
  controller.abort();
  await assert.rejects(reconnect, error => error?.name === 'AbortError');
  assert.equal(client.status, 'reconnecting');
  await client.disconnect();
});

test('a complete forward snapshot recovers a sequence gap without another resync', async () => {
  let context;
  let resyncs = 0;
  const gaps = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; }, resync() { resyncs += 1; } }
  });
  client.on('stream.gap', gap => gaps.push(gap));
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 1 }, players: [] } });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 3, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 3 }, players: [] } });
  assert.equal(client.state.get().match.gameTime, 3);
  assert.equal(resyncs, 0);
  assert.deepEqual(gaps, [{ expected: 2, received: 3 }]);
  await client.disconnect();
});

test('a reconnect resets sequence tracking for the new snapshot', async () => {
  let context;
  const transport = { name: 'test', async open(value) { context = value; } };
  const client = createClient({ clientId: 'test_app', transport });
  await client.open();
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 20, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 20 }, players: [] } });
  assert.equal(client.state.isSynchronized, true);
  context.onStatus('reconnecting');
  assert.equal(client.state.isSynchronized, false);
  const synchronized = client.whenSynchronized({ timeout: 0 });
  assert.equal((await client.whenReady()).match.gameTime, 20);
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.patch', data: [{ op: 'replace', path: '/match/gameTime', value: 999 }] });
  assert.equal(client.state.get().match.gameTime, 20);
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 2, type: 'state.snapshot', data: {capabilities: [],  gameContext: { hudScale: 1 }, match: {id: '', status: 'none', mode: 'undefined',  gameTime: 21 }, players: [] } });
  assert.equal(client.state.get().match.gameTime, 21);
  assert.equal((await synchronized).match.gameTime, 21);
  assert.equal(client.state.isSynchronized, true);
});

test('freshness-only transitions notify state subscribers without replacing state', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; }, close() {} }
  });
  let publications = 0;
  client.state.subscribe(() => { publications += 1; });
  const freshness = [];
  client.state.watch(
    () => client.state.isSynchronized,
    synchronized => freshness.push(synchronized)
  );
  await client.open();
  const snapshot = {capabilities: [],
    gameContext: { hudScale: 1 }, match: { id: 'same', status: 'running', gameTime: 20, mode: '1v1' },
    players: []
  };
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 20, type: 'state.snapshot', data: snapshot });
  const preservedState = client.state.get();
  context.onStatus('reconnecting');
  const synchronized = client.whenSynchronized({ timeout: 100 });
  context.onMessage({ version: PROTOCOL_VERSION, sequence: 1, type: 'state.snapshot', data: snapshot });

  assert.equal(await synchronized, preservedState);
  assert.equal(client.state.get(), preservedState);
  assert.equal(client.state.isSynchronized, true);
  assert.equal(client.lifecycle.get().isSynchronized, true);
  assert.equal(publications, 4);
  assert.deepEqual(freshness, [false, true, false, true]);
  await client.disconnect();
});

test('explicit disconnect clears state and the same client can openClient cleanly again', async () => {
  let context;
  let opens = 0;
  const transport = {
    name: 'test',
    async open(value) { context = value; opens += 1; },
    close() {}
  };
  const client = createClient({ clientId: 'test_app', transport });
  const snapshots = [];
  client.state.subscribe(state => snapshots.push(state?.match.id ?? null));

  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'first', status: 'running', gameTime: 1, mode: '1v1' }, players: [] }
  });
  assert.equal(client.state.get().match.id, 'first');

  await client.disconnect();
  assert.equal(client.state.get(), null);
  assert.equal(client.diagnostics.transport, null);
  assert.equal(client.diagnostics.protocolVersion, null);

  const ready = client.whenReady({ timeout: 0 });
  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'second', status: 'running', gameTime: 2, mode: '1v1' }, players: [] }
  });
  assert.equal((await ready).match.id, 'second');
  assert.equal(opens, 2);
  await client.disconnect();
  assert.deepEqual(snapshots, [null, 'first', null, 'second', null]);
});

test('a fatal transport error is closed before an explicit reconnect', async () => {
  let context;
  let opens = 0;
  let closes = 0;
  const transport = {
    name: 'test',
    open(value) { context = value; opens += 1; },
    close() { closes += 1; }
  };
  const client = createClient({ clientId: 'test_app', transport });
  await client.open();
  context.onStatus('error');
  assert.equal(client.status, 'error');
  await client.open();
  assert.equal(opens, 2);
  assert.equal(closes, 1);
  await client.disconnect();
  assert.equal(closes, 2);
});

test('disconnect and per-wait signals settle pending whenReady calls immediately', async () => {
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'no-state', open() {}, close() {} }
  });
  await client.open();
  const disconnected = client.whenReady({ timeout: 0 });
  await client.disconnect();
  await assert.rejects(disconnected, error => error?.name === 'AbortError');

  await client.open();
  const controller = new AbortController();
  const cancelled = client.whenReady({ timeout: 0, signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, error => error?.name === 'AbortError');
  await client.disconnect();
});

test('a startup signal cancels an in-flight transport and closes the client', async () => {
  const controller = new AbortController();
  let closed = false;
  const client = createClient({
    clientId: 'test_app',
    transport: {
      name: 'pending',
      open: () => new Promise(() => {}),
      close: () => { closed = true; }
    }
  });
  const startup = client.start({ signal: controller.signal });
  controller.abort();
  await assert.rejects(startup, error => error?.name === 'AbortError');
  assert.equal(closed, true);
  assert.equal(client.status, 'closed');
});

test('start keeps frontend startup pending until synchronized state arrives', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'delayed-state', open(value) { context = value; }, close() {} }
  });
  let settled = false;
  const starting = client.start().then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false);
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: 'ready', status: 'running', gameTime: 1, mode: '1v1' }, players: [] }
  });
  assert.equal(await starting, client);
  assert.equal(client.state.isSynchronized, true);
  await client.disconnect();
});

test('start rejects when synchronization becomes permanently unavailable', async () => {
  let context;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'fatal-before-state', open(value) { context = value; }, close() {} }
  });
  const starting = client.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  const failure = new ConnectionError('The configured application does not exist.', [], 'CONFIGURATION', 404);
  context.onError(failure);
  context.onStatus('error');
  await assert.rejects(starting, error => error === failure);
  assert.equal(client.lifecycle.get().error, failure);
  await client.disconnect();
});

test('subscription signals remove state and event listeners together', async () => {
  const controller = new AbortController();
  const client = await openClient({ clientId: 'test_app', demo: { interval: 5 } });
  let states = 0;
  let statuses = 0;
  client.state.subscribe(() => { states += 1; }, { signal: controller.signal });
  client.on('status', () => { statuses += 1; }, { signal: controller.signal });
  controller.abort();
  const stateCount = states;
  await new Promise(resolve => setTimeout(resolve, 12));
  await client.disconnect();
  assert.equal(states, stateCount);
  assert.equal(statuses, 0);
});

test('status subscriptions immediately expose the current lifecycle state', async () => {
  const client = createClient({ clientId: 'test_app', demo: { interval: 0 } });
  const statuses = [];
  const unsubscribe = client.subscribeStatus(status => statuses.push(status));
  await client.open();
  unsubscribe();
  await client.disconnect();
  assert.deepEqual(statuses, ['idle', 'connecting', 'connected']);
});

test('lifecycle methods validate options and listeners before registering', async () => {
  const client = await openClient({ clientId: 'test_app', demo: { interval: 0 } });
  assert.throws(() => client.state.subscribe(() => {}, null), /options/);
  assert.throws(() => client.state.watch(() => 1, () => {}, { signal: {} }), /AbortSignal/);
  assert.throws(() => client.on('status', () => {}, { signal: {} }), /AbortSignal/);
  assert.throws(() => client.once('status', null), /listener/);
  assert.throws(() => client.whenReady({ timeout: -1 }), /timeout/);
  assert.throws(() => client.whenReady({ signal: {} }), /AbortSignal/);
  await assert.rejects(client.start({ until: 'eventually' }), /start.until/);
  await assert.rejects(client.start({ timeout: -1 }), /start.timeout/);
  const cancelledStartup = new AbortController();
  cancelledStartup.abort();
  await assert.rejects(client.start({ signal: cancelledStartup.signal }), error => error?.name === 'AbortError');
  await client.disconnect();
});

test('initial retry uses SDK backoff and stops retrying protocol failures', async () => {
  let transientOpens = 0;
  const transient = createClient({
    clientId: 'test_app',
    retry: { maxAttempts: 3, initialDelay: 0, maxDelay: 0 },
    transport: {
      name: 'transient',
      open() {
        transientOpens += 1;
        if (transientOpens < 3) throw new ConnectionError('not ready');
      },
      close() {}
    }
  });
  await transient.open();
  assert.equal(transientOpens, 3);
  await transient.disconnect();

  let protocolOpens = 0;
  const incompatible = createClient({
    clientId: 'test_app',
    retry: { maxAttempts: 5 },
    transport: {
      name: 'incompatible',
      open() { protocolOpens += 1; throw new ProtocolError('UNSUPPORTED_PROTOCOL', 'unsupported'); },
      close() {}
    }
  });
  await assert.rejects(incompatible.open(), ProtocolError);
  assert.equal(protocolOpens, 1);
  await incompatible.disconnect();

  let configurationOpens = 0;
  const misconfigured = createClient({
    clientId: 'test_app',
    retry: { maxAttempts: 5 },
    transport: {
      name: 'misconfigured',
      open() { configurationOpens += 1; throw new ConnectionError('unknown app', [], 'CONFIGURATION', 404); },
      close() {}
    }
  });
  await assert.rejects(misconfigured.open(), error => error?.code === 'CONFIGURATION');
  assert.equal(configurationOpens, 1);
  await misconfigured.disconnect();
});

test('openClient is single-flight while a transport is opening', async () => {
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
  const client = createClient({ clientId: 'test_app', transport });
  const first = client.open();
  const second = client.open();
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
  const client = createClient({ clientId: 'test_app', transport });
  const connecting = client.open();
  await Promise.resolve();
  await client.disconnect();
  await assert.rejects(connecting, error => error?.name === 'AbortError');
  assert.equal(closes, 1);
  assert.equal(client.status, 'closed');
  assert.equal(client.diagnostics.transport, null);
  await client.open();
  assert.equal(client.status, 'connected');
  assert.equal(opens, 2);
  await client.disconnect();
});

test('an AbortSignal cancels the initial connection attempt', async () => {
  const controller = new AbortController();
  const client = createClient({
    clientId: 'test_app',
    signal: controller.signal,
    transport: { name: 'never-opens', open() { return new Promise(() => {}); }, close() {} }
  });
  const connecting = client.open();
  controller.abort();
  await assert.rejects(connecting, error => error?.name === 'AbortError');
  assert.equal(client.status, 'closed');
  assert.equal(client.lifecycle.get().status, 'closed');
  assert.equal(client.state.get(), null);
});

test('recorder team-color booleans normalize numeric string values', () => {
  const state = {
    capabilities: [], match: {status: 'none', gameTime: 0, mode: 'undefined',  id: 'match' },
    players: [],
    gameContext: { hudScale: 1, teamColors: true }
  };
  const disabled = applyLocalRecorderUpdates(state, [{ class: 'W3TeamColor', value: '0' }]);
  const enabled = applyLocalRecorderUpdates(disabled, [{ class: 'W3TeamColor', value: '1' }]);

  assert.equal(disabled.gameContext.teamColors, false);
  assert.equal(enabled.gameContext.teamColors, true);
});

test('the connection AbortSignal owns the established client lifetime', async () => {
  const controller = new AbortController();
  const client = await openClient({ clientId: 'test_app', demo: true, signal: controller.signal });
  assert.equal(client.status, 'connected');
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(client.status, 'closed');
  assert.equal(client.state.get(), null);
});

test('the default cloud backend receives the launch credential without probing localhost', async () => {
  const original = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    window: globalThis.window,
    location: globalThis.location,
    history: globalThis.history
  };
  const requests = [];
  const hostMessages = [];
  const hostListeners = new Set();
  const host = { postMessage(message) { hostMessages.push(message); } };
  globalThis.window = {
    parent: host,
    opener: null,
    addEventListener(type, listener) { if (type === 'message') hostListeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'message') hostListeners.delete(listener); }
  };
  globalThis.location = { hash: '#w3session=launch-secret', pathname: '/app', search: '?w3surface=application' };
  const routerState = { navigationId: 17 };
  globalThis.history = {
    state: routerState,
    replaceState(state, _title, url) { requests.push({ cleanedUrl: url, cleanedState: state }); }
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization, credentials: options.credentials, body: JSON.parse(options.body) });
    return { ok: true, status: 200, async json() { return {
      websocketUrl: 'wss://stream.example/apps?ticket=once',
      protocolVersion: PROTOCOL_VERSION,
      applicationRevision: 'revision-current'
    }; } };
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
    const client = await openClient({ clientId: 'test_app', applicationRevision: 'revision-current' });
    const brokerRequests = requests.filter(request => request.url);
    assert.equal(brokerRequests.length, 1);
    assert.ok(brokerRequests.every(request => request.authorization === 'Bearer launch-secret'));
    assert.ok(brokerRequests.every(request => request.credentials === undefined));
    assert.match(brokerRequests[0].url, /^https:\/\/api\.w3booster\.com\/stream\/v1\/stream-tickets$/);
    assert.deepEqual(brokerRequests[0].body.scopes, []);
    assert.deepEqual(brokerRequests[0].body.protocolVersions, [PROTOCOL_VERSION]);
    assert.equal(brokerRequests[0].body.sdkVersion, SDK_VERSION);
    assert.equal(brokerRequests[0].body.applicationRevision, 'revision-current');
    assert.equal(requests[0].cleanedUrl, '/app?w3surface=application');
    assert.equal(requests[0].cleanedState, routerState);
    assert.equal(client.host.available, true, 'a broker-authenticated application launch authorizes its captured host window');
    await Promise.resolve();
    const automaticCapabilities = hostMessages.find(message => message.command === 'host.capabilities.get');
    for (const listener of hostListeners) listener({
      source: host,
      origin: '',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: automaticCapabilities.requestId, ok: true, value: { capabilities: ['command'] }
      }
    });
    const scoreChange = client.host.command('example.command', { enabled: true });
    const scoreMessage = hostMessages.at(-1);
    assert.equal(scoreMessage.command, 'example.command');
    for (const listener of hostListeners) listener({
      source: host,
      origin: '',
      data: {
        source: 'w3booster-host', clientId: 'test_app', type: 'host.response',
        requestId: scoreMessage.requestId, ok: true, value: { accepted: true }
      }
    });
    assert.deepEqual(await scoreChange, { accepted: true });
    await client.disconnect();
  } finally {
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
    if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
    if (original.location === undefined) delete globalThis.location; else globalThis.location = original.location;
    if (original.history === undefined) delete globalThis.history; else globalThis.history = original.history;
  }
});

test('backend auto continues to cloud after local authorization fails', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (String(url).includes('localhost')) {
      return { ok: false, status: 401, async json() { return { authorizeUrl: 'https://localhost/authorize' }; } };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=once', protocolVersion: PROTOCOL_VERSION }; }
    };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    close() { this.readyState = 3; this.listeners.get('close')?.(); }
    send() {}
  };
  try {
    const client = await openClient({ clientId: 'test_app', backend: 'auto', tokenProvider: () => 'session' });
    assert.deepEqual(requests, [
      'https://localhost:25080/stream/v1/stream-tickets',
      'https://api.w3booster.com/stream/v1/stream-tickets'
    ]);
    assert.equal(client.diagnostics.transport, 'cloud');
    await client.disconnect();
  } finally {
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
  }
});

test('backend auto continues to cloud after the local broker times out', async () => {
  const original = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    setTimeout: globalThis.setTimeout
  };
  const requests = [];
  globalThis.setTimeout = (callback, delay, ...args) =>
    original.setTimeout(callback, delay === 5000 ? 0 : delay, ...args);
  globalThis.fetch = (url, options) => {
    requests.push(String(url));
    if (String(url).includes('localhost')) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=once', protocolVersion: PROTOCOL_VERSION }; }
    });
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    close() { this.readyState = 3; this.listeners.get('close')?.(); }
    send() {}
  };
  try {
    const client = await openClient({ clientId: 'test_app', backend: 'auto', tokenProvider: () => 'session' });
    assert.deepEqual(requests, [
      'https://localhost:25080/stream/v1/stream-tickets',
      'https://api.w3booster.com/stream/v1/stream-tickets'
    ]);
    assert.equal(client.diagnostics.transport, 'cloud');
    await client.disconnect();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('an explicit token provider is refreshed for every broker ticket', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const authorizations = [];
  const sockets = [];
  let tokenCalls = 0;
  globalThis.fetch = async (_url, options) => {
    authorizations.push(options.headers.Authorization);
    return {
      ok: true,
      status: 200,
      async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=once', protocolVersion: PROTOCOL_VERSION }; }
    };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      sockets.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    emit(type) { this.listeners.get(type)?.({}); }
    close() { this.readyState = 3; this.emit('close'); }
    send() {}
  };
  const client = createClient({
    clientId: 'test_app',
    tokenProvider: () => `session-${++tokenCalls}`
  });
  try {
    await client.open();
    const reconnected = new Promise(resolve => {
      let reconnecting = false;
      client.on('status', status => {
        if (status === 'reconnecting') reconnecting = true;
        if (reconnecting && status === 'connected') resolve();
      });
    });
    sockets[0].emit('close');
    await reconnected;
    assert.equal(tokenCalls, 2);
    assert.deepEqual(authorizations, ['Bearer session-1', 'Bearer session-2']);
  } finally {
    await client.disconnect();
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
  }
});

test('broker reconnect stops after a permanent configuration failure', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const sockets = [];
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return {
      ok: true,
      status: 200,
      async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=first', protocolVersion: PROTOCOL_VERSION }; }
    };
    return { ok: false, status: 404, async json() { return {}; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); sockets.push(this); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    emit(type) { this.listeners.get(type)?.({}); }
    close() { this.readyState = 3; this.emit('close'); }
    send() {}
  };
  const client = createClient({
    clientId: 'test_app',
    tokenProvider: () => 'session',
    reconnect: { maxAttempts: 5, initialDelay: 0, maxDelay: 0 }
  });
  const issues = [];
  client.on('issue', issue => issues.push(issue));
  try {
    await client.open();
    const failed = new Promise(resolve => client.on('status', status => {
      if (status === 'error') resolve();
    }));
    sockets[0].emit('close');
    await failed;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests, 2);
    assert.equal(client.status, 'error');
    assert.equal(issues.at(-1)?.source, 'connection');
    assert.equal(issues.at(-1)?.recoverable, false);
    assert.equal(client.lifecycle.get().error?.code, 'CONFIGURATION');
  } finally {
    await client.disconnect();
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
  }
});

test('disconnect aborts an in-flight broker reconnect before it can create another socket', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const sockets = [];
  let fetchCount = 0;
  let reconnectAborted = false;
  globalThis.fetch = async (_url, options) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return {
        ok: true,
        status: 200,
        async json() { return { websocketUrl: 'wss://stream.example/apps?ticket=first', protocolVersion: PROTOCOL_VERSION }; }
      };
    }
    return await new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reconnectAborted = true;
        reject(options.signal.reason || new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); sockets.push(this); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    emit(type) { this.listeners.get(type)?.({}); }
    close() { this.readyState = 3; this.emit('close'); }
    send() {}
  };
  try {
    const client = await openClient({ clientId: 'test_app', tokenProvider: () => 'session' });
    sockets[0].emit('close');
    await new Promise(resolve => setTimeout(resolve, 520));
    assert.equal(fetchCount, 2);
    await client.disconnect();
    assert.equal(reconnectAborted, true);
    assert.equal(sockets.length, 1);
    assert.equal(client.status, 'closed');
  } finally {
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
  }
});

test('broker timeouts include reading the response body', async () => {
  const original = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  let bodyAborted = false;
  globalThis.setTimeout = (callback, delay, ...args) =>
    original.setTimeout(callback, delay === 5000 ? 0 : delay, ...args);
  globalThis.fetch = async (_url, options) => ({
    ok: true,
    status: 200,
    json() {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          bodyAborted = true;
          reject(options.signal.reason || new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
  });
  globalThis.WebSocket = class {};
  const client = createClient({ clientId: 'test_app', tokenProvider: () => 'session' });
  let connecting;
  try {
    connecting = client.open();
    await assert.rejects(connecting, ConnectionError);
    assert.equal(bodyAborted, true);
  } finally {
    if (connecting) void connecting.catch(() => {});
    await client.disconnect();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
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
    const client = createClient({ clientId: 'test_app', tokenProvider: () => 'session', signal: controller.signal });
    const connecting = client.open();
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
    const client = await openClient({
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
    const client = await openClient({
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
    return { ok: true, async json() { return { apps: [{ appId: 'one', launchKey: 'launch-one', expiresAt: '2030-01-01T00:00:00Z', colorScheme: 'normal', clientId: 'child', name: 'Child', url: 'https://child.test/#w3session=token' }] }; } };
  };
  try {
    const apps = await getOverlayComposition({
      surface: 'ingameOverlay',
      browserSource: { channel: 'user', secret: 'secret' }
    });
    assert.equal(apps[0].clientId, 'child');
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.url.startsWith('https://api.w3booster.com/')));
    assert.match(requests[0].url, /\/stream\/v1\/compositor-sessions$/);
    assert.deepEqual(requests[0].body, { channel: 'user', secret: 'secret', surface: 'ingameOverlay' });
    assert.match(requests[1].url, /\/stream\/v1\/composite-launches$/);
    assert.equal(requests[1].authorization, 'Bearer compositor-session');
    assert.deepEqual(requests[1].body, { surface: 'ingameOverlay' });
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  }
});

test('explicit compositor credentials fail clearly when missing and support cancellation', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return { ok: false, status: 401, async json() { return {}; } };
  };
  try {
    await assert.rejects(
      getOverlayComposition({ tokenProvider: () => null }),
      error => error?.name === 'PermissionRequiredError'
    );
    assert.equal(requests, 0);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(getOverlayComposition({ signal: controller.signal }), error => error?.name === 'AbortError');
    assert.equal(requests, 0);
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  }
});

test('compositor options and successful responses are validated at runtime', async () => {
  await assert.rejects(getOverlayComposition(null), /options/);
  await assert.rejects(getOverlayComposition({ surface: 'application' }), /surface/);
  await assert.rejects(getOverlayComposition({ backend: 'locla' }), /auto, local, or cloud/);
  await assert.rejects(getOverlayComposition({ backendUrl: '' }), /backendUrl/);
  await assert.rejects(getOverlayComposition({ backend: 'cloud', backendUrl: 'https://example.com' }), /either backend or backendUrl/);
  await assert.rejects(getOverlayComposition({ browserSource: { channel: '', secret: '' } }), /channel and secret/);
  await assert.rejects(watchOverlayComposition({}, null), /listener/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { apps: [{ clientId: 'incomplete' }] }; } });
  try {
    await assert.rejects(
      getOverlayComposition({ backend: 'local', tokenProvider: () => 'session' }),
      error => error instanceof ProtocolError
    );
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  }
});

test('compositor app launches reject credentialed and insecure remote URLs', async () => {
  const originalFetch = globalThis.fetch;
  let appUrl = 'http://remote.example/overlay#w3session=secret';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { apps: [{ appId: 'one', launchKey: 'launch-one', expiresAt: '2030-01-01T00:00:00Z', colorScheme: 'normal', clientId: 'child', name: 'Child', url: appUrl }] }; }
  });
  try {
    for (const rejectedUrl of [
      'http://remote.example/overlay#w3session=secret',
      'https://user:password@remote.example/overlay#w3session=secret'
    ]) {
      appUrl = rejectedUrl;
      await assert.rejects(
        getOverlayComposition({ backend: 'local', tokenProvider: () => 'session' }),
        error => error instanceof ProtocolError && error.code === 'INVALID_RESPONSE'
      );
    }

    appUrl = 'http://127.0.0.1:8082/overlay#w3session=secret';
    const apps = await getOverlayComposition({ backend: 'local', tokenProvider: () => 'session' });
    assert.equal(apps[0]?.url, appUrl);
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  }
});

test('anonymous compositor loading distinguishes no authorization from platform failure', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 401, async json() { return {}; } });
    await assert.doesNotReject(async () => assert.deepEqual(
      await getOverlayComposition({ backend: 'local' }),
      []
    ));
    globalThis.fetch = async () => ({ ok: false, status: 500, async json() { return {}; } });
    await assert.rejects(
      getOverlayComposition({ backend: 'local' }),
      error => error instanceof ConnectionError && error.causes.some(cause =>
        cause instanceof ConnectionError && cause.code === 'UNAVAILABLE' && cause.status === 500)
    );
    globalThis.fetch = async () => ({ ok: false, status: 404, async json() { return {}; } });
    await assert.rejects(
      getOverlayComposition({ backend: 'local' }),
      error => error instanceof ConnectionError && error.code === 'CONFIGURATION' && error.status === 404
    );
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  }
});

test('overlay composition establishes a new session when auto falls back to cloud', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const request = { url: String(url), authorization: options.headers.Authorization };
    requests.push(request);
    if (request.url.startsWith('https://localhost') && request.url.endsWith('/compositor-sessions')) {
      return { ok: true, status: 200, async json() { return { sessionToken: 'local-session' }; } };
    }
    if (request.url.startsWith('https://localhost')) throw new Error('local compositor unavailable');
    if (request.url.endsWith('/compositor-sessions')) {
      return { ok: true, status: 200, async json() { return { sessionToken: 'cloud-session' }; } };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { apps: [{ appId: 'one', launchKey: 'launch-one', expiresAt: '2030-01-01T00:00:00Z', colorScheme: 'normal', clientId: 'child', name: 'Child', url: 'https://child.test/' }] }; }
    };
  };
  try {
    const apps = await getOverlayComposition({
      backend: 'auto',
      browserSource: { channel: 'user', secret: 'secret' }
    });
    assert.equal(apps[0].clientId, 'child');
    assert.deepEqual(requests.map(request => request.url), [
      'https://localhost:25080/stream/v1/compositor-sessions',
      'https://localhost:25080/stream/v1/composite-launches',
      'https://api.w3booster.com/stream/v1/compositor-sessions',
      'https://api.w3booster.com/stream/v1/composite-launches'
    ]);
    assert.equal(requests[3].authorization, 'Bearer cloud-session');
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch; else globalThis.fetch = originalFetch;
  }
});

test('overlay composition auto fallback distinguishes timeouts from cancellation', async () => {
  const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  const requests = [];
  globalThis.setTimeout = (callback, delay, ...args) =>
    original.setTimeout(callback, delay === 5000 ? 0 : delay, ...args);
  globalThis.fetch = (url, options) => {
    requests.push(String(url));
    if (String(url).startsWith('https://localhost')) {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
      });
    }
    if (String(url).endsWith('/compositor-sessions')) {
      return Promise.resolve({ ok: true, status: 200, async json() { return { sessionToken: 'cloud-session' }; } });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      async json() { return { apps: [{ appId: 'one', launchKey: 'launch-one', expiresAt: '2030-01-01T00:00:00Z', colorScheme: 'normal', clientId: 'child', name: 'Child', url: 'https://child.test/' }] }; }
    });
  };
  try {
    const apps = await getOverlayComposition({
      backend: 'auto',
      browserSource: { channel: 'user', secret: 'secret' }
    });
    assert.equal(apps[0].clientId, 'child');
    assert.deepEqual(requests, [
      'https://localhost:25080/stream/v1/compositor-sessions',
      'https://api.w3booster.com/stream/v1/compositor-sessions',
      'https://api.w3booster.com/stream/v1/composite-launches'
    ]);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
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
    return {
      ok: true,
      async json() { return { apps: [{ appId: 'one', launchKey: 'launch-one', expiresAt: '2030-01-01T00:00:00Z', colorScheme: 'normal', clientId: 'child-app', name: 'Child', url: 'https://child.test/' }] }; }
    };
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
  const errors = [];
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization, body: JSON.parse(options.body) });
    return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://localhost:25081/composition?surface=streamOverlay' }; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    constructor(url, protocols) {
      this.url = String(url);
      this.protocols = protocols;
      this.closed = false;
      this.listeners = new Map();
      sockets.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => listener());
    }
    close() { this.closed = true; this.listeners.get('close')?.(); }
  };

  try {
    const controller = new AbortController();
    const watcher = await watchOverlayComposition({
      backend: 'local',
      surface: 'streamOverlay',
      tokenProvider: () => 'compositor-session',
      onError: error => errors.push(error),
      signal: controller.signal
    }, async event => {
      events.push(event);
      throw new Error('async compositor listener failed');
    });
    assert.deepEqual(requests, [{
      url: 'https://localhost:25080/stream/v1/composition-watch',
      authorization: 'Bearer compositor-session',
      body: { surface: 'streamOverlay' }
    }]);
    assert.equal(sockets[0].url, 'wss://localhost:25081/composition?surface=streamOverlay');
    assert.deepEqual(sockets[0].protocols, ['w3booster-compositor', 'compositor-session']);
    sockets[0].listeners.get('message')({ data: JSON.stringify({ type: 'composition.changed', surface: 'streamOverlay' }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(events, [{ type: 'composition.changed', surface: 'streamOverlay' }]);
    assert.equal(errors[0]?.message, 'async compositor listener failed');
    sockets[0].listeners.get('message')({ data: JSON.stringify({ type: 'composition.changed', surface: 'application' }) });
    assert.equal(errors[1]?.code, 'INVALID_MESSAGE');
    controller.abort();
    assert.equal(sockets[0].closed, true);
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

test('overlay composition stops reconnecting after a permanent authorization failure', async () => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const sockets = [];
  const errors = [];
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) {
      return { ok: true, status: 200, async json() { return { websocketUrl: 'wss://localhost:25081/composition' }; } };
    }
    return { ok: false, status: 403, async json() { return {}; } };
  };
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = new Map(); sockets.push(this); }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
      if (type === 'open') queueMicrotask(() => { this.readyState = 1; listener(); });
    }
    send() {}
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.listeners.get('close')?.();
    }
  };

  let watcher;
  try {
    watcher = await watchOverlayComposition({
      backend: 'local',
      tokenProvider: () => 'session',
      onError: error => errors.push(error)
    }, () => {});
    sockets[0].close();
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(requests, 3, 'one rejected credential is refreshed once before the failure becomes permanent');
    assert.equal(errors.at(-1)?.code, 'PERMISSION_REQUIRED');
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(requests, 3);
    assert.equal(sockets.length, 1);
  } finally {
    watcher?.close();
    if (original.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = original.fetch;
    if (original.WebSocket === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original.WebSocket;
  }
});

test('unsupported protocol majors are rejected without mutating state', async () => {
  let context;
  let error;
  let resyncs = 0;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; }, resync() { resyncs++; } }
  });
  client.on('issue', issue => { error = issue.error; });
  await client.open();
  context.onMessage({
    version: '99.0',
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
  });
  assert.equal(client.state.get(), null);
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, 'UNSUPPORTED_PROTOCOL');
  assert.equal(resyncs, 0);
  assert.equal(client.status, 'error');
  assert.equal(client.lifecycle.get().error, error);
  await client.disconnect();
});

test('runtime validation enforces the public state types', async () => {
  let context;
  const errors = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.on('issue', ({ error }) => errors.push(error));
  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'not-a-status', gameTime: 1, mode: '1v1' },
      players: []
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [{ id: 7, resources: { gold: 'invalid' } }]
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 3,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [{ id: '7', resources: { gold: 'invalid', lumber: 0, supply: 0, supplyCap: 0 } }]
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 4,
    type: 'state.snapshot',
    data: {capabilities: [],  match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [],
      gameContext: { hudScale: 'invalid' }
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 5,
    type: 'state.snapshot',
    data: {capabilities: [],  match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [],
      gameContext: { hudScale: 1.2 }
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 6,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1.5, mode: '1v1' },
      players: []
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 7,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1', startedAt: 'yesterday' },
      players: []
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 8,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [{ id: '7', mainAccount: { name: 'Player', mainRace: 1 } }]
    }
  });
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 9,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'running', gameTime: 1, mode: '1v1' },
      players: [{ id: '7', stats: { solo: { wins: 1, losses: 1, winRate: 101 } } }]
    }
  });
  assert.equal(client.state.get(), null);
  assert.match(errors[0]?.message, /Unknown match status/);
  assert.match(errors[1]?.message, /valid ID/);
  assert.match(errors[2]?.message, /resources.gold/);
  assert.match(errors[3]?.message, /hudScale/);
  assert.match(errors[4]?.message, /between 0.5 and 1.0/);
  assert.match(errors[5]?.message, /core fields/);
  assert.match(errors[6]?.message, /ISO-8601/);
  assert.match(errors[7]?.message, /mainRace/);
  assert.match(errors[8]?.message, /between 0 and 100/);
  await client.disconnect();
});

test('match completion timestamps must be ISO-8601 and survive state validation', async () => {
  let context;
  const errors = [];
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.on('issue', ({ error }) => errors.push(error));
  await client.open();

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: { id: 'match', status: 'finished', gameTime: 100, mode: '1v1', endedAt: 'later' },
      players: []
    }
  });
  assert.equal(client.state.get(), null);
  assert.match(errors.at(-1)?.message, /endedAt must be an ISO-8601 timestamp/);

  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 2,
    type: 'state.snapshot',
    data: {capabilities: [],
      gameContext: { hudScale: 1 }, match: {
        id: 'match', status: 'finished', gameTime: 100, mode: '1v1',
        endedAt: '2026-08-19T00:00:10.000Z'
      },
      players: []
    }
  });
  assert.equal(client.state.get()?.match.endedAt, '2026-08-19T00:00:10.000Z');
  await client.disconnect();
});

test('active and completed matches require stable identity', async () => {
  let context;
  let error;
  const client = createClient({
    clientId: 'test_app',
    transport: { name: 'test', async open(value) { context = value; } }
  });
  client.on('issue', issue => { error = issue.error; });
  await client.open();
  context.onMessage({
    version: PROTOCOL_VERSION,
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: '', status: 'running', gameTime: 1, mode: '1v1' }, players: [] }
  });
  assert.equal(client.state.get(), null);
  assert.match(error?.message, /non-empty ID/);
  await client.disconnect();
});

test('unversioned protocol envelopes are rejected', async () => {
  let context;
  let error;
  let closes = 0;
  let resyncs = 0;
  const issues = [];
  const client = createClient({
    clientId: 'test_app',
    transport: {
      name: 'test',
      async open(value) { context = value; },
      close() { closes += 1; },
      resync() { resyncs += 1; }
    }
  });
  client.on('issue', issue => { error = issue.error; });
  client.on('issue', issue => issues.push(issue));
  await client.open();
  context.onMessage({
    sequence: 1,
    type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
  });
  assert.equal(client.state.get(), null);
  assert.equal(error?.code, 'UNSUPPORTED_PROTOCOL');
  await Promise.resolve();
  assert.equal(client.status, 'error');
  assert.equal(client.lifecycle.get().isSynchronized, false);
  assert.equal(issues.at(-1)?.recoverable, false);
  assert.equal(resyncs, 0);
  assert.equal(closes, 1);
  await client.disconnect();
});

test('unsafe patch paths cannot mutate object prototypes', async () => {
  let context;
  let error;
  const client = createClient({ clientId: 'test_app', transport: { name: 'test', async open(value) { context = value; } } });
  client.on('issue', issue => { error = issue.error; });
  await client.open();
  context.onMessage({
    version: '2.0', sequence: 1, type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 0, mode: 'undefined' }, players: [] }
  });
  context.onMessage({
    version: '2.0', sequence: 2, type: 'state.patch',
    data: [{ op: 'add', path: '/__proto__/w3boosterPolluted', value: true }]
  });
  assert.equal(Object.prototype.w3boosterPolluted, undefined);
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, 'UNSAFE_PATCH');
  context.onMessage({
    version: '2.0', sequence: 3, type: 'state.patch',
    data: [{ op: 'replace', path: '/match/gameTime', value: 999 }]
  });
  assert.equal(client.state.get().match.gameTime, 0);
  context.onMessage({
    version: '2.0', sequence: 4, type: 'state.snapshot',
    data: {capabilities: [],  gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 4, mode: 'undefined' }, players: [] }
  });
  assert.equal(client.state.get().match.gameTime, 4);
  await client.disconnect();
});
