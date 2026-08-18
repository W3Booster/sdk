import test from 'node:test';
import assert from 'node:assert/strict';
import { defineApplication } from '../src/app.js';

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
  assert.equal(runtime.lifecycle.get().status, 'closed');
  assert.equal(runtime.lifecycle.get().state, null);
  await assert.rejects(runtime.start(), /has been stopped/);
});

test('managed application runtime start and stop are single-flight operations', async () => {
  const app = defineApplication(definition);
  const runtime = app.createRuntime({ demo: { interval: 0 } });
  const [first, second] = await Promise.all([runtime.start(), runtime.start()]);
  assert.equal(first, second);
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(runtime.client.status, 'closed');
});
