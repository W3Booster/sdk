import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/index.js';
import { validateState } from '../src/internal/protocol.js';

const state = (result) => ({ capabilities: ['match'], gameContext: { hudScale: 1 }, match: { id: 'game', status: 'finished', gameTime: 800, mode: '1v1',
  endedAt: '2026-09-05T12:00:00.000Z', ...(result === undefined ? {} : { result }) }, players: [] });

test('SDK retains immutable recorder outcomes in state and hydrated match lifecycle observations', async () => {
  const client = createClient({ clientId: 'result_test', demo: { state: state({ playerId: '0', outcome: 'won' }), interval: 0 } });
  try {
    await client.start();
    const events = [];
    client.subscribeMatchLifecycle(event => events.push(event), { includeCurrentFinished: true });
    assert.deepEqual(client.state.get().match.result, { playerId: '0', outcome: 'won' });
    assert.ok(Object.isFrozen(client.state.get().match.result));
    assert.equal(events[0].phase, 'ended');
    assert.equal(events[0].match.result.outcome, 'won');
  } finally { await client.disconnect(); }
});
test('unknown result stays absent and malformed outcomes are rejected', () => {
  assert.equal(validateState(state(), 'result_test').match.result, undefined);
  for (const result of [null, false, { playerId: '0', outcome: 'unknown' }, { playerId: '', outcome: 'lost' }]) {
    assert.throws(() => validateState(state(result), 'result_test'), /result/);
  }
});
