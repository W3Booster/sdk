import assert from 'node:assert/strict';
import test from 'node:test';
import {
  battleTagName,
  broadcasterFirstTeams,
  broadcasterPlayer,
  currentUpgrades,
  groupPlayersByTeam,
  hasCapability,
  headToHeadPair,
  heroInventory,
  inventorySlotIdentity,
  isActiveMatch,
  playerHeroes,
  playerDisplayIdentity,
  playerResources,
  playerResourcesOrZero,
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
  assert.equal(headToHeadPair(players), null);
  const pair = headToHeadPair(players.slice(0, 2));
  assert.deepEqual(pair, players.slice(0, 2));
  assert.equal(Object.isFrozen(pair), true);
  assert.equal(headToHeadPair(players.slice(0, 1)), null);
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
  assert.deepEqual(
    broadcasterFirstTeams(
      [{ id: 'opponent', team: 1 }, { id: 'broadcaster' }],
      { broadcasterPlayerId: 'broadcaster' }
    ).map(team => team.teamId),
    [null, 1]
  );
  assert.equal(playerRelationship(players[0], { broadcasterPlayerId: 'broadcaster' }, players), 'ally');
  assert.equal(playerRelationship(players[1], { broadcasterPlayerId: 'broadcaster' }, players), 'opponent');
  assert.equal(playerRelationship(players[2], { broadcasterPlayerId: 'broadcaster' }, players), 'self');
  assert.equal(playerRelationship(players[0], {}, players), 'unknown');
  assert.equal(playerRelationship({ id: 'unknown' }, { broadcasterPlayerId: 'broadcaster' }, [...players, { id: 'unknown' }]), 'unknown');
  assert.equal(groupPlayersByTeam([{ id: 'unknown' }])[0].teamId, null);
  assert.deepEqual(
    groupPlayersByTeam([{ name: 'persisted unknown', team: null }, { name: 'known', team: 0 }])
      .map(team => team.teamId),
    [null, 0]
  );
  assert.deepEqual(playerDisplayIdentity({
    id: 'player', name: 'InGame', mainAccount: { name: 'Account' }
  }), {
    primaryName: 'Account', inGameName: 'InGame', accountName: 'Account', hasAlias: true
  });
  assert.deepEqual(playerDisplayIdentity({ id: 'player', name: 'Same', mainAccount: { name: 'Same' } }), {
    primaryName: 'Same', inGameName: 'Same', accountName: 'Same', hasAlias: false
  });
  assert.deepEqual(playerDisplayIdentity({ id: 'fallback' }), {
    primaryName: 'fallback', inGameName: 'fallback', accountName: undefined, hasAlias: false
  });
  assert.deepEqual(playerDisplayIdentity(
    { id: 'player', name: 'Player#1234' },
    { stripBattleTagDiscriminator: true }
  ), {
    primaryName: 'Player', inGameName: 'Player', accountName: undefined, hasAlias: false
  });
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
  assert.equal(playerHeroes(undefined), playerHeroes({}));
  assert.equal(playerResources(undefined), undefined);
  assert.equal(playerResourcesOrZero(undefined), playerResourcesOrZero({}));
  assert.deepEqual(playerResourcesOrZero(undefined), { gold: 0, lumber: 0, supply: 0, supplyCap: 0, workerSupply: 0 });
  assert.equal(inventorySlotIdentity(0, 'ratf'), '0:ratf');
  assert.equal(upgradeIdentity({ name: 'Rhme', level: 2 }), 'Rhme:2');
  assert.throws(() => inventorySlotIdentity(-1, 'ratf'), /non-negative integer/);
  assert.throws(() => upgradeIdentity({ name: '', level: 1 }), /name and finite level/);
});

test('display identity strips BattleTag discriminators from both account and in-game names', () => {
  assert.deepEqual(playerDisplayIdentity({
    id: 'player',
    name: 'InGame#1234',
    mainAccount: { name: 'Account#5678' }
  }, { stripBattleTagDiscriminator: true }), {
    primaryName: 'Account',
    inGameName: 'InGame',
    accountName: 'Account',
    hasAlias: true
  });
});

test('allocating selectors preserve identity for immutable structurally shared inputs', () => {
  const players = Object.freeze([
    Object.freeze({ id: 'one', team: 0 }),
    Object.freeze({ id: 'two', team: 1 })
  ]);
  assert.equal(groupPlayersByTeam(players), groupPlayersByTeam(players));
  assert.equal(
    broadcasterFirstTeams(players, { broadcasterPlayerId: 'one' }),
    broadcasterFirstTeams(players, { broadcasterPlayerId: 'one' })
  );
  const upgrades = Object.freeze({
    active: Object.freeze([Object.freeze({ name: 'Rhme', level: 1 })]),
    researching: Object.freeze([])
  });
  assert.equal(currentUpgrades({ upgrades }), currentUpgrades({ upgrades }));
  const firstIdentity = playerDisplayIdentity(players[0]);
  playerDisplayIdentity(players[1]);
  assert.equal(playerDisplayIdentity(players[0]), firstIdentity);
});

test('allocating selectors recompute for mutable frontend-owned inputs', () => {
  const players = [{ id: 'one', team: 0 }];
  assert.deepEqual(groupPlayersByTeam(players).map(team => team.teamId), [0]);
  players.push({ id: 'two', team: 1 });
  assert.deepEqual(groupPlayersByTeam(players).map(team => team.teamId), [0, 1]);

  const upgrades = { active: [], researching: [] };
  const player = { upgrades };
  assert.deepEqual(currentUpgrades(player), []);
  upgrades.active.push({ name: 'Rhme', level: 1 });
  assert.deepEqual(currentUpgrades(player), [{ name: 'Rhme', level: 1 }]);

  const identity = { id: 'one', name: 'First' };
  assert.equal(playerDisplayIdentity(identity).primaryName, 'First');
  identity.name = 'Second';
  assert.equal(playerDisplayIdentity(identity).primaryName, 'Second');
});
