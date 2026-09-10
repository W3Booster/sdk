import test from 'node:test';
import assert from 'node:assert/strict';
import { defineApplication } from '../src/app.js';
import { ConnectionError } from '../src/index.js';
import { createSelectorStore } from '../src/store.js';
import { createDemoState } from '../src/testing.js';

const definition = {
  clientId: 'app_test',
  revision: 'revision-1',
  scopes: ['match:read'],
  settingsDefaults: { display: { enabled: true, label: 'Player' } }
};

test('application bindings own runtime behavior and resolve immutable settings', () => {
  const app = defineApplication(definition);
  const delivered = Object.freeze({ display: Object.freeze({ label: 'Caster' }) });
  const first = app.resolveSettings(delivered);
  const second = app.resolveSettings(delivered);

  assert.equal(first, second);
  assert.deepEqual(first, { display: { enabled: true, label: 'Caster' } });
  assert.equal(Object.isFrozen(app), true);
  assert.equal(Object.isFrozen(app.scopes), true);
  assert.equal(Object.isFrozen(app.settingsDefaults.display), true);
});

test('application settings memoization never returns stale values for mutable inputs', () => {
  const app = defineApplication(definition);
  const delivered = { display: { label: 'Caster' } };
  assert.equal(app.resolveSettings(delivered).display.label, 'Caster');
  delivered.display.label = 'Observer';
  assert.equal(app.resolveSettings(delivered).display.label, 'Observer');

  const shallowlyFrozen = Object.freeze({ display: { label: 'First' } });
  assert.equal(app.resolveSettings(shallowlyFrozen).display.label, 'First');
  shallowlyFrozen.display.label = 'Second';
  assert.equal(app.resolveSettings(shallowlyFrozen).display.label, 'Second');

  const immutable = Object.freeze({ display: Object.freeze({ label: 'Frozen' }) });
  assert.equal(app.resolveSettings(immutable), app.resolveSettings(immutable));
  assert.throws(() => app.resolveSettings(null), /delivered settings/);
});

test('application bindings validate metadata and prevent broader runtime scopes', () => {
  assert.throws(
    () => defineApplication({ ...definition, scopes: ['unknown:read'] }),
    /known W3Booster scopes/
  );
  assert.throws(
    () => defineApplication({ ...definition, scopes: ['match:read', 'match:read'] }),
    /duplicates/
  );
  const app = defineApplication(definition);
  assert.throws(() => app.createClient(null), /options must be an object/);
  assert.throws(() => app.createClient({ scopes: ['players:read'] }), /not configured/);
});

test('generated application bindings send their exact definition revision to transports', async () => {
  let context;
  const app = defineApplication(definition);
  const client = app.createClient({
    transport: { name: 'revision-test', open(value) { context = value; }, close() {} }
  });
  await client.open();
  assert.equal(context.applicationRevision, definition.revision);
  await client.disconnect();
});

test('application startup keeps lifetime and startup cancellation independent', async () => {
  const lifetime = new AbortController();
  const startup = new AbortController();
  const app = defineApplication(definition);
  const client = await app.start({
    signal: lifetime.signal,
    demo: { interval: 0 }
  }, { signal: startup.signal });

  startup.abort();
  await Promise.resolve();
  assert.equal(client.status, 'connected');

  lifetime.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(client.status, 'closed');
});

test('managed application runtimes publish client, resolved settings, host state, and teardown atomically', async () => {
  const app = defineApplication(definition);
  const runtime = app.createRuntime({
    demo: { interval: 0, settings: { display: { label: 'Observer' } } }
  });
  const snapshots = [];
  runtime.lifecycle.subscribe(snapshot => snapshots.push(snapshot));

  assert.equal(runtime.lifecycle.get().client, runtime.client);
  assert.equal(runtime.signal.aborted, false);
  assert.deepEqual(runtime.lifecycle.get().settings, definition.settingsDefaults);
  assert.equal(runtime.lifecycle.get().host.capabilityStatus, 'unavailable');

  const client = await runtime.start();
  assert.equal(client, runtime.client);
  assert.equal(runtime.lifecycle.get().status, 'connected');
  assert.equal(runtime.lifecycle.get().isSynchronized, true);
  assert.equal(runtime.lifecycle.get().settings.display.label, 'Observer');
  assert.equal(app.settingsFor(runtime.lifecycle.get().state), runtime.lifecycle.get().settings);
  assert.ok(snapshots.length >= 3);

  await runtime.stop();
  assert.equal(runtime.signal.aborted, true);
  assert.equal(runtime.lifecycle.get().status, 'closed');
  assert.equal(runtime.lifecycle.get().state, null);
  await assert.rejects(runtime.start(), /has been stopped/);
  assert.throws(() => runtime.lifecycle.subscribe(() => {}), /has been stopped/);
});

test('managed application runtimes publish initial retry progress', async () => {
  let attempts = 0;
  const app = defineApplication(definition);
  const runtime = app.createRuntime({
    retry: { maxAttempts: 2, initialDelay: 0, maxDelay: 0 },
    transport: {
      name: 'runtime-retry-test',
      open() {
        attempts += 1;
        if (attempts === 1) throw new ConnectionError('offline');
      },
      close() {}
    }
  });
  const snapshots = [];
  runtime.lifecycle.subscribe(snapshot => snapshots.push(snapshot));

  await runtime.start({ until: 'connected' });

  assert.equal(snapshots.some(snapshot => snapshot.retry?.attempt === 2 && snapshot.retry.nextDelay === 0), true);
  assert.equal(runtime.lifecycle.get().retry, null);
  await runtime.stop();
});

test('managed runtime teardown never publishes a half-updated client and host aggregate', async () => {
  const original = {
    window: globalThis.window,
    location: globalThis.location,
    document: globalThis.document
  };
  const hostWindow = { postMessage() {} };
  globalThis.window = {
    parent: hostWindow,
    opener: null,
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.location = {
    search: '?w3surface=application',
    hash: '#w3session=launch-session',
    origin: 'http://localhost:8082'
  };
  globalThis.document = { referrer: 'https://app.w3booster.com/apps' };
  try {
    const app = defineApplication(definition);
    const runtime = app.createRuntime({
      transport: {
        name: 'atomic-runtime-test',
        open(context) {
          context.onMessage({
            version: '3.0',
            sequence: 1,
            type: 'state.snapshot',
            data: createDemoState({
              clientId: definition.clientId,
              settings: definition.settingsDefaults
            })
          });
        },
        close() {}
      }
    });
    const snapshots = [];
    runtime.lifecycle.subscribe(snapshot => snapshots.push(snapshot));
    await runtime.start();
    assert.equal(runtime.lifecycle.get().host.available, true);
    snapshots.length = 0;

    await runtime.stop();

    assert.equal(snapshots.some(snapshot =>
      snapshot.status === 'connected' && snapshot.isSynchronized && !snapshot.host.available
    ), false);
    assert.equal(snapshots.some(snapshot =>
      (snapshot.status === 'closed' || snapshot.status === 'error') && snapshot.host.available
    ), false);
    assert.equal(snapshots.at(-1).status, 'closed');
    assert.equal(snapshots.at(-1).host.available, false);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('managed application runtime start and stop are single-flight operations', async () => {
  const app = defineApplication(definition);
  const runtime = app.createRuntime({ demo: { interval: 0 } });
  const [first, second] = await Promise.all([runtime.start(), runtime.start()]);
  assert.equal(first, second);
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(runtime.client.status, 'closed');
});

test('managed application runtime keeps concurrent startup milestones independent', async () => {
  let context;
  const app = defineApplication(definition);
  const runtime = app.createRuntime({
    transport: {
      name: 'delayed-state',
      open(value) {
        context = value;
        value.onStatus('connected');
      },
      close() {}
    }
  });
  const connected = runtime.start({ until: 'connected' });
  const synchronized = runtime.start();

  await connected;
  assert.equal(runtime.lifecycle.get().isSynchronized, false);
  let synchronizedResolved = false;
  synchronized.then(() => { synchronizedResolved = true; });
  await Promise.resolve();
  assert.equal(synchronizedResolved, false);

  context.onMessage({
    version: '3.0',
    sequence: 1,
    type: 'state.snapshot',
    data: createDemoState({ clientId: definition.clientId, settings: definition.settingsDefaults })
  });
  await synchronized;
  assert.equal(runtime.lifecycle.get().isSynchronized, true);
  await runtime.stop();
});

test('managed application runtime timeout bounds transport opening without cancelling shared startup', async () => {
  let releaseOpen;
  const app = defineApplication(definition);
  const runtime = app.createRuntime({
    transport: {
      name: 'delayed-open',
      open(context) {
        return new Promise(resolve => {
          releaseOpen = () => {
            context.onStatus('connected');
            resolve();
          };
        });
      },
      close() {}
    }
  });
  const bounded = runtime.start({ until: 'connected', timeout: 5 });
  const shared = runtime.start({ until: 'connected' });

  await assert.rejects(bounded, error => error?.code === 'STARTUP_TIMEOUT');
  assert.equal(runtime.lifecycle.get().status, 'connecting');
  releaseOpen();
  assert.equal(await shared, runtime.client);
  assert.equal(runtime.lifecycle.get().status, 'connected');
  await runtime.stop();
});

test('managed application runtime timeout includes initial retry backoff', async () => {
  let attempts = 0;
  const app = defineApplication(definition);
  const runtime = app.createRuntime({
    retry: { maxAttempts: 2, initialDelay: 25, maxDelay: 25 },
    transport: {
      name: 'delayed-retry',
      open(context) {
        attempts += 1;
        if (attempts === 1) throw new ConnectionError('temporarily unavailable');
        context.onStatus('connected');
      },
      close() {}
    }
  });
  const bounded = runtime.start({ until: 'connected', timeout: 5 });
  const shared = runtime.start({ until: 'connected' });

  await assert.rejects(bounded, error => error?.code === 'STARTUP_TIMEOUT');
  assert.equal(runtime.lifecycle.get().retry?.attempt, 2);
  assert.equal(await shared, runtime.client);
  assert.equal(attempts, 2);
  await runtime.stop();
});

test('managed application runtime cancellation is scoped to one startup caller', async () => {
  let context;
  const app = defineApplication(definition);
  const runtime = app.createRuntime({
    transport: {
      name: 'delayed-state',
      open(value) {
        context = value;
        value.onStatus('connected');
      },
      close() {}
    }
  });
  await runtime.start({ until: 'connected' });
  const cancellation = new AbortController();
  const cancelled = runtime.start({ signal: cancellation.signal });
  const synchronized = runtime.start();
  cancellation.abort();
  await assert.rejects(cancelled, error => error?.name === 'AbortError');
  assert.equal(runtime.lifecycle.get().status, 'connected');

  context.onMessage({
    version: '3.0',
    sequence: 1,
    type: 'state.snapshot',
    data: createDemoState({ clientId: definition.clientId, settings: definition.settingsDefaults })
  });
  await synchronized;
  await runtime.stop();
});

test('managed application runtime listener failures use the client issue channel', async () => {
  const app = defineApplication(definition);
  const runtime = app.createRuntime({ demo: { interval: 0 } });
  const issues = [];
  runtime.client.on('issue', issue => issues.push(issue));
  runtime.lifecycle.subscribe(() => { throw new Error('runtime consumer failed'); });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].source, 'listener');
  assert.equal(issues[0].recoverable, true);
  assert.equal(issues[0].error.message, 'runtime consumer failed');
  assert.equal(runtime.lifecycle.get().error, null);
  await runtime.stop();
});

test('managed application runtime derived-store failures preserve the client issue channel', async () => {
  const app = defineApplication(definition);
  const runtime = app.createRuntime({ demo: { interval: 0 } });
  const issues = [];
  runtime.client.on('issue', issue => issues.push(issue));
  const status = createSelectorStore(runtime.lifecycle, snapshot => snapshot.status);
  status.subscribe(() => { throw new Error('derived consumer failed'); });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].source, 'listener');
  assert.equal(issues[0].error.message, 'derived consumer failed');
  await runtime.stop();
});
