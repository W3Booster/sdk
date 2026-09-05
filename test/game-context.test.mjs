import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/index.js';
import { gameContext } from '../src/selectors.js';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';

const base = () => ({ capabilities: [], match: { id: '', status: 'none', gameTime: 0, mode: '' }, players: [] });
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
test('modern game context wins over legacy runtime without leaking score or transport fields', async () => {
  const state = await delivered({ ...base(), gameContext: { hudScale: 0.75, teamColors: false, chatbarOpen: false, matchScore: { wins: 9, losses: 0 }, privateField: true },
    overlay: { runtime: { hudScale: 1, teamColors: true, chatbarOpen: true } },
    application: { clientId: 'context_test', settings: {}, data: { matchScore: { wins: 2, losses: 1 } } } });
  assert.deepEqual(state.gameContext, { hudScale: 0.75, teamColors: false, chatbarOpen: false });
  assert.deepEqual(state.application.data, { matchScore: { wins: 2, losses: 1 } });
  assert.equal(state.overlay.runtime.matchScore, undefined);
});
test('legacy snapshots supply game context during rolling deployment', async () => {
  const state = await delivered({ ...base(), overlay: { runtime: { hudScale: 0.8, teamColors: true } } });
  assert.deepEqual(state.gameContext, { hudScale: 0.8, teamColors: true });
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
