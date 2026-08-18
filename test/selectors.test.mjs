import assert from 'node:assert/strict';
import test from 'node:test';
import {
  battleTagName,
  broadcasterFirstTeams,
  broadcasterPlayer,
  currentUpgrades,
  groupPlayersByTeam,
  hasCapability,
  heroInventory,
  inventorySlotIdentity,
  isActiveMatch,
  matchScore,
  overlayRuntime,
  playerHeroes,
  playerResources,
  playerRelationship,
  upgradeIdentity
} from '../src/selectors.js';

test('selectors expose common match and player derivations', () => {
  const players = [
    { id: 'ally', team: 1 },
    { id: 'opponent', team: 0 },
    { id: 'broadcaster', team: 1 }
  ];

  assert.equal(isActiveMatch({ status: 'starting' }), true);
  assert.equal(isActiveMatch({ status: 'finished' }), false);
  assert.equal(hasCapability({ capabilities: ['players'] }, 'players'), true);
  assert.equal(hasCapability({ capabilities: ['players'] }, 'resources'), false);
  assert.equal(broadcasterPlayer({ broadcasterPlayerId: 'broadcaster' }, players)?.id, 'broadcaster');
  assert.equal(broadcasterPlayer({}, players), null);
  assert.equal(broadcasterPlayer({}, players, { fallbackToFirst: true })?.id, 'ally');
  assert.equal(broadcasterPlayer({}, [{ id: 'undefined' }]), null);
  assert.equal(broadcasterPlayer({}, [{ id: 'undefined' }], { fallbackToFirst: true })?.id, 'undefined');
  assert.deepEqual(groupPlayersByTeam(players).map(team => ({
    teamId: team.teamId,
    players: team.players.map(player => player.id)
  })), [
    { teamId: 1, players: ['ally', 'broadcaster'] },
    { teamId: 0, players: ['opponent'] }
  ]);
  assert.deepEqual(
    broadcasterFirstTeams(players, { broadcasterPlayerId: 'opponent' }).map(team => team.teamId),
    [0, 1]
  );
  assert.deepEqual(
    broadcasterFirstTeams(players, { broadcasterPlayerId: 'opponent' }, { reverse: true }).map(team => team.teamId),
    [1, 0]
  );
  assert.equal(playerRelationship(players[0], { broadcasterPlayerId: 'broadcaster' }, players), 'ally');
  assert.equal(playerRelationship(players[1], { broadcasterPlayerId: 'broadcaster' }, players), 'opponent');
  assert.equal(playerRelationship(players[2], { broadcasterPlayerId: 'broadcaster' }, players), 'self');
  assert.equal(playerRelationship(players[0], {}, players), 'unknown');
  assert.equal(playerRelationship({ id: 'unknown' }, { broadcasterPlayerId: 'broadcaster' }, [...players, { id: 'unknown' }]), 'unknown');
  assert.equal(groupPlayersByTeam([{ id: 'unknown' }])[0].teamId, null);
});

test('current upgrades merge overlapping active and researching records', () => {
  const active = { name: 'Rhme', level: 2, gametime: 1 };
  const researching = { name: 'Rhar', level: 1, gametime: 2, researchStart: '2026-01-01T00:00:00.000Z' };
  const player = { upgrades: { upgrades: [], active: [active], researching: [active, researching] } };
  assert.deepEqual(currentUpgrades(player), [active, researching]);
  assert.deepEqual(currentUpgrades(player, { includeResearching: false }), [active]);
});

test('selectors expose canonical inventory and preserve non-BattleTag hashes', () => {
  assert.deepEqual(heroInventory({ inventory: ['ratf'] }), ['ratf']);
  assert.deepEqual(heroInventory({ inventory: ['rin1'] }), ['rin1']);
  assert.deepEqual(heroInventory(undefined), []);
  assert.equal(battleTagName('W3Pad#1234'), 'W3Pad');
  assert.equal(battleTagName('Team#EU'), 'Team#EU');
  assert.equal(battleTagName(undefined), undefined);
  assert.equal(overlayRuntime(undefined), overlayRuntime({}));
  assert.equal(playerHeroes(undefined), playerHeroes({}));
  assert.equal(playerResources(undefined), playerResources({}));
  assert.deepEqual(playerResources(undefined), { gold: 0, lumber: 0, supply: 0, supplyCap: 0, workerSupply: 0 });
  assert.equal(matchScore(undefined), matchScore({}));
  assert.deepEqual(matchScore(undefined), { wins: 0, losses: 0 });
  const runtime = { overlay: { runtime: { matchScore: { wins: 2, losses: 1 } } } };
  assert.equal(matchScore(runtime), runtime.overlay.runtime.matchScore);
  assert.equal(inventorySlotIdentity(0, 'ratf'), '0:ratf');
  assert.equal(upgradeIdentity({ name: 'Rhme', level: 2 }), 'Rhme:2');
  assert.throws(() => inventorySlotIdentity(-1, 'ratf'), /non-negative integer/);
  assert.throws(() => upgradeIdentity({ name: '', level: 1 }), /name and finite level/);
});
