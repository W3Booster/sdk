import assert from 'node:assert/strict';
import test from 'node:test';
import {
  battleTagName,
  broadcasterPlayer,
  groupPlayersByTeam,
  heroInventory,
  isActiveMatch,
  playerRelationship
} from '../src/selectors.js';

test('selectors expose common match and player derivations', () => {
  const players = [
    { id: 'ally', team: 1 },
    { id: 'opponent', team: 0 },
    { id: 'broadcaster', team: 1 }
  ];

  assert.equal(isActiveMatch({ status: 'starting' }), true);
  assert.equal(isActiveMatch({ status: 'finished' }), false);
  assert.equal(broadcasterPlayer({ broadcasterPlayerId: 'broadcaster' }, players)?.id, 'broadcaster');
  assert.equal(broadcasterPlayer({}, players), null);
  assert.equal(broadcasterPlayer({}, players, { fallbackToFirst: true })?.id, 'ally');
  assert.deepEqual(groupPlayersByTeam(players).map(team => ({
    teamId: team.teamId,
    players: team.players.map(player => player.id)
  })), [
    { teamId: 1, players: ['ally', 'broadcaster'] },
    { teamId: 0, players: ['opponent'] }
  ]);
  assert.equal(playerRelationship(players[0], { broadcasterPlayerId: 'broadcaster' }, players), 'ally');
  assert.equal(playerRelationship(players[1], { broadcasterPlayerId: 'broadcaster' }, players), 'opponent');
  assert.equal(playerRelationship(players[2], { broadcasterPlayerId: 'broadcaster' }, players), 'self');
  assert.equal(playerRelationship(players[0], {}, players), 'unknown');
  assert.equal(playerRelationship({ id: 'unknown' }, { broadcasterPlayerId: 'broadcaster' }, [...players, { id: 'unknown' }]), 'unknown');
  assert.equal(groupPlayersByTeam([{ id: 'unknown' }])[0].teamId, null);
});

test('selectors hide compatibility fields and preserve non-BattleTag hashes', () => {
  assert.deepEqual(heroInventory({ items: ['ratf'], inventory: ['ignored'] }), ['ratf']);
  assert.deepEqual(heroInventory({ inventory: ['rin1'] }), ['rin1']);
  assert.deepEqual(heroInventory(undefined), []);
  assert.equal(battleTagName('W3Pad#1234'), 'W3Pad');
  assert.equal(battleTagName('Team#EU'), 'Team#EU');
  assert.equal(battleTagName(undefined), undefined);
});
