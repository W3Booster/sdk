import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';
import { validateState } from '../src/internal/protocol.js';
const baseline = () => ({ capabilities: [], gameContext: { hudScale: 1 }, players: [],
  match: { id: '42', status: 'running', gameTime: 1, mode: '4v4', isReplay: true } });
test('hero bar layout preserves sparse slots without adding owned heroes', () => {
  let state = baseline();
  for (const value of [1, 4, 7, 3, 0, null, 4]) {
    const previous = structuredClone(state);
    const next = applyLocalRecorderUpdates(state, [{ class: 'W3HeroBar', matchId: '42', value }]);
    assert.deepEqual(state, previous);
    validateState(next, undefined, false);
    assert.equal(next.gameContext.heroBarLastOccupiedSlot, value ?? undefined);
    assert.deepEqual(next.players, []);
    state = next;
  }
  for (const value of [undefined, -1, 4.5, 33, '4', NaN, Infinity, true]) {
    assert.deepEqual(applyLocalRecorderUpdates(state, [{ class: 'W3HeroBar', value }]), state);
  }
  assert.deepEqual(applyLocalRecorderUpdates(state, [{ class: 'W3HeroBar', matchId: 'other', value: 7 }]), state);
});
test('snapshot validation accepts only optional integer native slot indices', () => {
  for (const value of [undefined, 0, 1, 4, 7, 32]) {
    const state = baseline(); if (value !== undefined) state.gameContext.heroBarLastOccupiedSlot = value;
    validateState(state, undefined, false);
  }
  for (const value of [null, -1, 4.5, 33, '4', NaN, Infinity, true]) {
    const state = baseline(); if (value !== undefined) state.gameContext.heroBarLastOccupiedSlot = value;
    assert.throws(() => validateState(state, undefined, false), /hero-bar|heroBarLastOccupiedSlot/);
  }
});
