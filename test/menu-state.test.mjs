import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';
import { validateState } from '../src/internal/protocol.js';
const baseline = () => ({ capabilities: [], gameContext: { hudScale: 1 }, players: [],
  match: { id: '42', status: 'running', gameTime: 1, mode: '1v1', isReplay: true } });
test('local menu observations clear and recover without changing match mode or lifecycle', () => {
  let state = baseline();
  for (const value of [true, false, null, true]) {
    const previous = structuredClone(state);
    const next = applyLocalRecorderUpdates(state, [{ class: 'W3MenuState', matchId: '42', value }]);
    assert.deepEqual(state, previous);
    validateState(next, undefined, false);
    assert.equal(next.gameContext.menuOpen, value ?? undefined);
    assert.deepEqual(next.match, state.match);
    state = next;
  }
  for (const value of [undefined, 0, 1, 'true', {}, []]) {
    assert.deepEqual(applyLocalRecorderUpdates(state, [{ class: 'W3MenuState', value }]), state);
    const snapshot = baseline(); snapshot.gameContext.menuOpen = value;
    if (value !== undefined) assert.throws(() => validateState(snapshot, undefined, false), /menuOpen/);
  }
  assert.deepEqual(applyLocalRecorderUpdates(state, [{ class: 'W3MenuState', matchId: 'other', value: false }]), state);
});
