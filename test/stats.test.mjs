import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/index.js';
import { validateState } from '../src/internal/protocol.js';

function snapshot(realm, mmr) {
  return { capabilities: ['match:read', 'players:read', 'stats:read'], gameContext: { hudScale: 1 },
    match: { id: 'stats-match', status: 'running', gameTime: 30, mode: '1v1', realm, isReforged: false },
    players: [{ id: '0', stats: { status: 'ready', records: [{ provider: 'w3champions', gameMode: '1v1', queue: 'individual', wins: 3, losses: 1, winRate: 75, ...(mmr === undefined ? {} : { mmr }) }] } }] };
}

test('public snapshots retain MMR and realm independently of graphics mode', async () => {
  for (const realm of ['Reforged', 'W3Champions', 'W3Champions@EU', 'W3Champions@NA']) {
    const client = createClient({ clientId: 'stats_test', demo: { state: snapshot(realm, 3207), interval: 0 } });
    try {
      await client.start();
      const state = client.state.get();
      assert.equal(state.match.realm, realm);
      assert.equal(state.match.isReforged, false);
      assert.equal(state.players[0].stats.records[0].mmr, 3207);
      assert.ok(Object.isFrozen(state.players[0].stats.records[0]));
    } finally { await client.disconnect(); }
  }
});

test('MMR is optional, finite and never inferred from another stat', () => {
  for (const mmr of [undefined, 0, -1, 3207.5]) assert.doesNotThrow(() => validateState(snapshot('Reforged', mmr)));
  for (const mmr of [NaN, Infinity, -Infinity, '3207', null]) {
    assert.throws(() => validateState(snapshot('Reforged', mmr)), /mmr/);
  }
  const missing = snapshot('Reforged');
  missing.players[0].stats.records[0].level = 25;
  missing.players[0].stats.records[0].rank = 100;
  validateState(missing);
  assert.equal(missing.players[0].stats.records[0].mmr, undefined);
});

test('ladder selection never falls back across modes, races or arranged teams', async () => {
  const { statsForMode } = await import('../src/standard-game.js');
  const base = { provider: 'bnet', season: 9, wins: 3, losses: 1, winRate: 75 };
  const solo = { ...base, gameMode: '1v1', queue: 'individual', race: 'human', mmr: 3200 };
  const rt = { ...base, gameMode: '2v2', queue: 'individual', race: 'human', mmr: 3400 };
  const at = { ...base, gameMode: '2v2', queue: 'arranged', mmr: 5000, team: { id: 'team-a', members: [{ battleTag: 'One#1234' }, { battleTag: 'Two#2345' }] } };
  const player = { id: '0', race: 'human', stats: { status: 'ready', records: [solo, rt, at] } };
  assert.equal(statsForMode(player, '1v1'), solo);
  assert.equal(statsForMode(player, '3v3'), undefined);
  assert.equal(statsForMode(player, 'custom'), undefined);
  assert.equal(statsForMode({ ...player, race: 'orc' }, '1v1'), undefined);
  assert.equal(statsForMode(player, '2v2'), undefined);
  assert.equal(statsForMode(player, '2v2', { queue: 'individual' }), rt);
  assert.equal(statsForMode(player, '2v2', { teamId: 'team-a' }), at);
  assert.equal(statsForMode(player, '2v2', { teamId: 'team-b' }), undefined);
  assert.equal(statsForMode(player, '1v1', { season: 8 }), undefined);
  const state = snapshot('Reforged', 3207); state.players[0] = player; validateState(state);
  state.players[0].stats = { solo }; assert.throws(() => validateState(state), /records|status/);
});
