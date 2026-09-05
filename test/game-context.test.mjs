import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/index.js';
import { gameContext } from '../src/selectors.js';
import { validateState } from '../src/internal/protocol.js';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';

const base = () => ({ capabilities: [], gameContext: { hudScale: 1 }, match: { id: '', status: 'none', gameTime: 0, mode: '' }, players: [] });
async function delivered(state) {
  const client = createClient({ clientId: 'context_test', demo: { state, interval: 0 } });
  try { await client.start(); return client.state.get(); } finally { await client.disconnect(); }
}
test('game context needs no scope, exists while idle, and supplies a safe scale default', async () => {
  const state = await delivered(base());
  assert.deepEqual(state.gameContext, { hudScale: 1 });
  assert.deepEqual(state.capabilities, []);
  assert.ok(Object.isFrozen(state.gameContext));
  assert.equal(gameContext(state), state.gameContext);
  assert.equal(gameContext(null).hudScale, 1);
});
test('transport metadata stays private and app-owned score remains separate', async () => {
  const state = await delivered({ ...base(), gameContext: { hudScale: 0.75, teamColors: false, chatbarOpen: false },
    transport: { recorderUrls: ['ws://127.0.0.1:48123'] },
    application: { clientId: 'context_test', settings: {}, data: { matchScore: { wins: 2, losses: 1 } } } });
  assert.deepEqual(state.gameContext, { hudScale: 0.75, teamColors: false, chatbarOpen: false });
  assert.deepEqual(state.application.data, { matchScore: { wins: 2, losses: 1 } });
  assert.equal(state.transport, undefined);
  assert.equal(state.overlay, undefined);
});
test('hydration rejects missing game context and removed overlay state shapes', () => {
  const { gameContext: _, ...missing } = base();
  assert.throws(() => validateState(missing), /Game context/);
  for (const key of ['runtime', 'misc', 'settings']) {
    assert.throws(() => validateState({ ...base(), overlay: { [key]: {} } }), /retired/);
  }
  for (const hudScale of [undefined, NaN, 0.4, 1.1]) {
    assert.throws(() => validateState({ ...base(), gameContext: { hudScale } }));
  }
});
test('recorder context updates need no overlay permission and retain protected data gates', () => {
  const initial = { ...base(), gameContext: { hudScale: 1 }, players: [{ id: '0' }] };
  const state = applyLocalRecorderUpdates(initial, [
    { class: 'W3HudScale', value: 64 }, { class: 'W3ChatbarState', value: 1 }, { class: 'W3TeamColor', value: 0 },
    { class: 'W3Resource', slotId: 0, type: 1, value: 5000 }
  ]);
  assert.deepEqual(state.gameContext, { hudScale: 0.725, chatbarOpen: true, teamColors: false });
  assert.equal(state.players[0].resources, undefined);
  assert.deepEqual(initial.gameContext, { hudScale: 1 });
});

test('hydration requires every core field instead of inventing a partial state', () => {
  for (const key of ['capabilities', 'players', 'match', 'gameContext']) {
    const snapshot = base(); delete snapshot[key];
    assert.throws(() => validateState(snapshot));
  }
  for (const key of ['id', 'status', 'gameTime', 'mode']) {
    const snapshot = base(); delete snapshot.match[key];
    assert.throws(() => validateState(snapshot));
  }
});

test('removed client aliases, host score primitives, and scope cannot be used', async () => {
  const sdk = await import('../src/index.js');
  const client = createClient({ clientId: 'context_test', demo: true });
  assert.equal('connect' in sdk, false);
  assert.equal('connect' in client, false);
  assert.equal('changeMatchScore' in client.host, false);
  assert.equal('resetMatchScore' in client.host, false);
  assert.throws(() => createClient({ clientId: 'context_test', scopes: ['overlay:read'] }));
  assert.equal(sdk.canUseHostCapability({ available: true, capabilityStatus: 'legacy', capabilities: [] }, 'window:open'), false);
});
