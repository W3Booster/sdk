import test from 'node:test';
import assert from 'node:assert/strict';
import * as standardGame from '../src/standard-game.js';
import * as standardGameObjects from '../src/standard-game-objects.js';
import * as standardGameIcons from '../src/standard-game-icons.js';
import * as standardGameCooldowns from '../src/standard-game-cooldowns.js';

test('standard-game object namespace exposes optional shipped metadata and asset URLs', () => {
  assert.equal(standardGameObjects.getIcon('Hamg'), 'btnheroarchmage.png');
  assert.equal(standardGameObjects.iconFileName('Hamg'), 'btnheroarchmage.png');
  assert.equal(standardGameObjects.iconUrl('Hamg'), 'https://static.w3booster.com/assets/wc3/standard-game/v1/reforged/icons/btnheroarchmage.png');
  assert.equal(standardGameObjects.heroIconUrl({ id: 'Hamg' }), standardGameObjects.iconUrl('Hamg'));
  assert.equal(standardGameObjects.abilityIconUrl({ name: 'AHbz' }), standardGameObjects.iconUrl('AHbz'));
  assert.equal(standardGameObjects.upgradeIconUrl({ name: 'Rhme' }), standardGameObjects.iconUrl('Rhme'));
  assert.equal(standardGameObjects.itemIconUrl('ratf'), standardGameObjects.iconUrl('ratf'));
  assert.equal(standardGameObjects.iconUrl('ZZZZ'), undefined);
  assert.equal(standardGameObjects.heroIconUrl({ id: 'ZZZZ' }), undefined);
  assert.equal(standardGameObjects.iconFilenameUrl('btnblood&ghostkey', { graphics: 'classic', baseUrl: 'http://localhost:8080/assets/' }), 'http://localhost:8080/assets/wc3/standard-game/v1/classic/icons/btnblood%26ghostkey.png');
  assert.equal(standardGameObjects.iconUrl('../secret'), undefined);
  assert.equal(standardGameObjects.assetManifestUrl(), 'https://static.w3booster.com/assets/wc3/standard-game/v1/manifest.json');
  assert.equal(standardGameObjects.getAbilityCooldown('AHbz', 2), 6);
  assert.equal(standardGameObjects.getObject('custom-map-object'), undefined);
  assert.equal(standardGameObjects.getObject('__proto__'), undefined);
  assert.equal(standardGameObjects.getObject('toString'), undefined);
});

test('standard-game helpers normalize melee modes, races, colors, and hero progression', () => {
  assert.equal(standardGame.normalizeMode('1v1'), 'gm-1v1');
  assert.equal(standardGame.isMode('gm-4v4', '4v4'), true);
  assert.equal(standardGame.races['night-elf'].localizationKey, 'race.night-elf');
  assert.equal(standardGame.races.human.shortLocalizationKey, 'race.human.short');
  assert.equal(standardGame.raceInfo('night_elf'), standardGame.races['night-elf']);
  assert.equal(standardGame.raceInfo(undefined), standardGame.races.random);
  assert.equal(standardGame.playerColor(1), '#0042ff');
  assert.deepEqual(standardGame.heroExperienceState(350), {
    level: 2,
    experience: 350,
    levelStartExperience: 200,
    nextLevelExperience: 500,
    experienceIntoLevel: 150,
    experienceForNextLevel: 300,
    progress: 0.5
  });
  assert.equal(standardGame.valuePoolRatio({ current: 75, max: 100 }), 0.75);
  assert.equal(standardGame.valuePoolRatio({ current: 150, max: 100 }), 1);
  assert.equal(standardGame.valuePoolRatio({ current: -5, max: 100 }), 0);
  assert.equal(standardGame.valuePoolRatio({ current: 150, max: 100 }, { clamp: false }), 1.5);
  assert.equal(standardGame.isValuePoolDepleted({ current: 0 }), true);
  assert.equal(standardGame.upkeepState(50), 'none');
  assert.equal(standardGame.upkeepState(51), 'low');
  assert.equal(standardGame.upkeepState(80), 'low');
  assert.equal(standardGame.upkeepState(81), 'high');
  assert.equal(standardGame.upkeepState(null), undefined);
  assert.equal(standardGame.upkeepState(undefined), undefined);
  const west = { id: 'west', startPosition: { x: -100, y: 0 } };
  const east = { id: 'east', startPosition: { x: 100, y: 0 } };
  assert.deepEqual(standardGame.orderHeadToHeadPlayers([east, west]), [west, east]);
  assert.deepEqual(standardGame.orderHeadToHeadPlayers([east, west], { reverse: true }), [east, west]);
  assert.deepEqual(standardGame.orderHeadToHeadPlayers([{ id: 'unknown' }, east]), [{ id: 'unknown' }, east]);
});

test('standard-game metadata is immutable shared data', () => {
  assert.equal(Object.isFrozen(standardGameObjects.objects), true);
  assert.equal(Object.isFrozen(standardGameObjects.getObject('Hamg')), true);
});

test('allocating standard-game order selectors preserve identity for immutable player collections', () => {
  const players = Object.freeze([
    Object.freeze({ id: 'east', team: 1, startPosition: Object.freeze({ x: 100, y: 0 }) }),
    Object.freeze({ id: 'west', team: 0, startPosition: Object.freeze({ x: -100, y: 0 }) })
  ]);
  assert.equal(standardGame.orderHeadToHeadPlayers(players), standardGame.orderHeadToHeadPlayers(players));
  assert.equal(
    standardGame.orderMatchTeams(players, { isObserver: true, broadcasterPlayerId: 'east' }),
    standardGame.orderMatchTeams(players, { isObserver: true, broadcasterPlayerId: 'east' })
  );
});

test('standard-game order selectors recompute for mutable frontend-owned collections', () => {
  const players = [
    { id: 'east', team: 1, startPosition: { x: 100, y: 0 } },
    { id: 'west', team: 0, startPosition: { x: -100, y: 0 } }
  ];
  assert.deepEqual(standardGame.orderHeadToHeadPlayers(players).map(player => player.id), ['west', 'east']);
  players[0].startPosition.x = -200;
  assert.deepEqual(standardGame.orderHeadToHeadPlayers(players).map(player => player.id), ['east', 'west']);
  players.push({ id: 'third', team: 2, startPosition: { x: 0, y: 0 } });
  assert.deepEqual(
    standardGame.orderMatchTeams(players, { isObserver: true }).map(team => team.teamId),
    [1, 0, 2]
  );
});

test('specialized standard-game entry points preserve the combined API values', () => {
  assert.equal(standardGameIcons.getIcon('Hamg'), standardGameObjects.getIcon('Hamg'));
  assert.equal(standardGameIcons.getIcon('Rema3'), standardGameObjects.getIcon('Rema3'));
  assert.equal(standardGameCooldowns.getAbilityCooldown('AHbz', 2), standardGameObjects.getAbilityCooldown('AHbz', 2));
});

test('standard-game asset resolvers bind the catalog and derive graphics from match state', () => {
  const assets = standardGameObjects.createAssetResolver({ baseUrl: 'http://localhost:8083/' });
  assert.equal(Object.isFrozen(assets), true);
  assert.equal(
    assets.hero({ isReforged: false }, { id: 'Hamg' }),
    'http://localhost:8083/wc3/standard-game/v1/classic/icons/btnheroarchmage.png'
  );
  assert.equal(
    assets.ability({ isReforged: true }, { name: 'AHbz' }),
    'http://localhost:8083/wc3/standard-game/v1/reforged/icons/btnblizzard.png'
  );
  assert.equal(
    assets.countryFlag('DE'),
    'http://localhost:8083/country-flags/v1/flags/de.png'
  );
  const launchAssets = standardGameObjects.createAssetResolver({
    location: { search: '?backend=local&assetBaseUrl=http%3A%2F%2Flocalhost%3A9090%2Fassets' }
  });
  assert.equal(
    launchAssets.hero({ isReforged: true }, { id: 'Hamg' }),
    'http://localhost:9090/assets/wc3/standard-game/v1/reforged/icons/btnheroarchmage.png'
  );
  assert.equal(
    launchAssets.countryFlag('GB-ENG'),
    'http://localhost:9090/assets/country-flags/v1/flags/gb-eng.png'
  );
});

test('standard-game derives upgrade categories and statistics without application presentation rules', () => {
  const broadcaster = { id: 'me', team: 0, colorId: 0, stats: { solo: { wins: 4, losses: 2, winRate: 66.7 } } };
  assert.equal(standardGame.normalizeUpgradeRawcode('Rema3'), 'Rema');
  assert.equal(standardGameObjects.getIcon('Rema3'), standardGameObjects.getIcon('Rema'));
  assert.equal(standardGame.isWeaponOrArmorUpgrade('Rema3'), true);
  assert.equal(standardGame.isWeaponOrArmorUpgrade('Rhde'), false);
  assert.equal(standardGame.statsForMode(broadcaster, '1v1')?.wins, 4);
  assert.equal(standardGame.preferredStats({ stats: { team: { wins: 7, losses: 1, winRate: 87.5 } } }, 'custom')?.wins, 7);
  assert.equal(standardGame.formatGameTime(65), '01:05');
  assert.equal(standardGame.formatGameTime(65, { compactHours: true }), '1:05');
  assert.equal(standardGame.formatGameTime(3665), '1:01:05');
  assert.deepEqual(standardGame.modeInfo('gm-4v4'), standardGame.meleeModes['4v4']);
  assert.equal(standardGame.modeInfo('gm-4v4')?.kind, 'team');
  assert.equal(standardGame.modeInfo('custom'), undefined);
});

test('standard-game provides canonical frontend team ordering and presentation values', () => {
  const west = { id: 'west', team: 0, colorId: 5, startPosition: { x: -100, y: 0 } };
  const east = { id: 'east', team: 1, colorId: 4, startPosition: { x: 100, y: 0 } };
  const observerMatch = { mode: '1v1', isObserver: true, broadcasterPlayerId: 'east' };

  assert.deepEqual(
    standardGame.orderMatchTeams([east, west], observerMatch).map(team => team.players[0]?.id),
    ['west', 'east']
  );
  assert.deepEqual(
    standardGame.orderMatchTeams([east, west], observerMatch, { reverse: true }).map(team => team.players[0]?.id),
    ['east', 'west']
  );

  const teamPlayers = [
    { id: 'opponent', team: 1 },
    { id: 'me', team: 0 },
    { id: 'ally', team: 0 },
    { id: 'opponent-ally', team: 1 }
  ];
  assert.deepEqual(
    standardGame.orderMatchTeams(teamPlayers, { mode: '2v2', isObserver: true, broadcasterPlayerId: 'me' })
      .map(team => team.players.map(player => player.id)),
    [['me', 'ally'], ['opponent', 'opponent-ally']]
  );

  const incompleteTeamPlayers = [
    { id: 'opponent', team: 1, startPosition: { x: -100, y: 0 } },
    { id: 'me', team: 0, startPosition: { x: 100, y: 0 } }
  ];
  assert.deepEqual(
    standardGame.orderMatchTeams(incompleteTeamPlayers, {
      mode: '2v2', isObserver: true, broadcasterPlayerId: 'me'
    }).map(team => team.players[0]?.id),
    ['me', 'opponent']
  );
  const unexpectedThirdTeam = [
    { id: 'opponent', team: 1 },
    { id: 'me', team: 0 },
    { id: 'stray', team: 2 }
  ];
  assert.deepEqual(
    standardGame.orderMatchTeams(unexpectedThirdTeam, {
      mode: '2v2', isObserver: true, broadcasterPlayerId: 'me'
    }).map(team => team.teamId),
    [0, 1, 2]
  );
  assert.deepEqual(
    standardGame.orderMatchTeams(unexpectedThirdTeam, {
      mode: '2v2', isObserver: true, broadcasterPlayerId: 'me'
    }, { reverse: true }).map(team => team.teamId),
    [2, 1, 0]
  );

  const teamlessHeadToHead = [
    { id: 'east', startPosition: { x: 100, y: 0 } },
    { id: 'west', startPosition: { x: -100, y: 0 } }
  ];
  const observerTeamlessTeams = standardGame.orderMatchTeams(teamlessHeadToHead, {
    mode: '1v1', isObserver: true, broadcasterPlayerId: 'east'
  });
  assert.deepEqual(observerTeamlessTeams.map(team => team.players[0]?.id), ['west', 'east']);
  assert.deepEqual(observerTeamlessTeams.map(team => team.teamId), [null, null]);
  assert.deepEqual(
    standardGame.orderMatchTeams(teamlessHeadToHead, {
      mode: '1v1', isObserver: false, broadcasterPlayerId: 'east'
    }).map(team => team.players[0]?.id),
    ['east', 'west']
  );
  assert.deepEqual(
    standardGame.orderMatchTeams(incompleteTeamPlayers, {
      mode: '2v2', isObserver: false, broadcasterPlayerId: 'me'
    }).map(team => team.players[0]?.id),
    ['me', 'opponent']
  );

  const freeForAllPlayers = [0, 1, 2, 3].map(team => ({ id: `ffa-${team}`, team }));
  assert.deepEqual(
    standardGame.orderMatchTeams(freeForAllPlayers, { mode: '4ffa', isObserver: true })
      .map(team => team.teamId),
    [0, 1, 2, 3]
  );
  assert.deepEqual(
    standardGame.orderMatchTeams(freeForAllPlayers, { mode: '4ffa', isObserver: true }, { reverse: true })
      .map(team => team.teamId),
    [3, 2, 1, 0]
  );
  const teamlessFreeForAll = [0, 1, 2, 3].map(index => ({ id: `teamless-ffa-${index}` }));
  assert.deepEqual(
    standardGame.orderMatchTeams(teamlessFreeForAll, { mode: '4ffa', isObserver: true })
      .map(team => team.players[0]?.id),
    ['teamless-ffa-0', 'teamless-ffa-1', 'teamless-ffa-2', 'teamless-ffa-3']
  );
  assert.deepEqual(
    standardGame.orderMatchTeams(teamlessFreeForAll, { mode: '4ffa', isObserver: false }, { reverse: true })
      .map(team => team.players[0]?.id),
    ['teamless-ffa-3', 'teamless-ffa-2', 'teamless-ffa-1', 'teamless-ffa-0']
  );
  assert.deepEqual(
    standardGame.orderMatchTeams(teamlessFreeForAll, { mode: '4ffa', isObserver: true })
      .map(team => team.teamId),
    [null, null, null, null]
  );

  const colorPlayers = [
    { id: 'opponent', team: 1, colorId: 4 },
    { id: 'me', team: 0, colorId: 5 },
    { id: 'ally', team: 0, colorId: 6 }
  ];
  const playerMatch = { isObserver: false, broadcasterPlayerId: 'me' };
  assert.equal(standardGame.presentationPlayerColor(colorPlayers[1], playerMatch, colorPlayers), '#fe8a0e');
  assert.equal(standardGame.presentationPlayerColor(colorPlayers[1], playerMatch, colorPlayers, { teamColors: true }), '#0042ff');
  assert.equal(standardGame.presentationPlayerColor(colorPlayers[2], playerMatch, colorPlayers, { teamColors: true }), '#1ce6b9');
  assert.equal(standardGame.presentationPlayerColor(colorPlayers[0], playerMatch, colorPlayers, { teamColors: true }), '#ff0303');
  assert.equal(standardGame.presentationPlayerColor(colorPlayers[1], { ...playerMatch, isObserver: true }, colorPlayers, { teamColors: true }), '#1ce6b9');

  assert.equal(standardGame.formatHeroLevelProgress({ level: 2, experience: 300 }), '2.3');
  assert.equal(standardGame.formatHeroLevelProgress({ level: 4 }), '4');
  assert.equal(standardGame.formatHeroLevelProgress({ level: 10, experience: 9_999 }), '10');
});

test('standard-game owns cooldown timestamp and day/night clock semantics', () => {
  assert.deepEqual(standardGameObjects.abilityCooldown(
    { id: 'AHbz', name: 'AHbz', level: 1, lastActivation: 10_000 },
    12
  ), { total: 6, elapsed: 2, remaining: 4, progress: 1 / 3, active: true });
  assert.equal(standardGameObjects.abilityCooldown({ id: 'AHbz', name: 'AHbz', level: 1 }, 12), undefined);
  assert.equal(standardGameObjects.abilityCooldown(
    { id: 'AHbz', name: 'AHbz', level: 1, lastActivation: 0 },
    0
  ), undefined);
  assert.deepEqual(standardGameObjects.abilityCooldown(
    { id: 'AHbz', name: 'AHbz', level: 1, lastActivation: 10_500 },
    12
  ), { total: 6, elapsed: 1.5, remaining: 4.5, progress: 0.25, active: true });
  const state = {
    match: { id: 'match', status: 'running', gameTime: 12, mode: '1v1' },
    capabilities: ['match', 'players', 'heroes'],
    players: [{ id: '0', heroes: [{ id: 'Hamg', name: 'Archmage', level: 1, abilities: [
      { id: 'AHbz', name: 'AHbz', level: 1, lastActivation: 10_000 }
    ] }] }]
  };
  const cooldowns = standardGameObjects.abilityCooldownsForState(state);
  const cooldown = cooldowns.get(state.players[0].heroes[0].abilities[0]);
  assert.deepEqual(
    cooldown,
    { total: 6, elapsed: 2, remaining: 4, progress: 1 / 3, active: true }
  );
  assert.equal(Object.isFrozen(cooldown), true);
  assert.equal(Object.isFrozen(cooldowns), true);
  assert.equal(cooldowns instanceof Map, false);
  assert.throws(() => cooldowns.set(state.players[0].heroes[0].abilities[0], cooldown), /immutable/);
  assert.throws(
    () => Map.prototype.set.call(cooldowns, state.players[0].heroes[0].abilities[0], cooldown),
    /incompatible receiver|incompatible|Map/
  );
  assert.equal(cooldowns.size, 1);
  assert.equal(standardGameObjects.abilityCooldownsForState(state).size, 1);

  const immutableAbility = Object.freeze({ id: 'AHbz', name: 'AHbz', level: 1, lastActivation: 10_000 });
  const immutableState = Object.freeze({
    match: Object.freeze({ id: 'match', status: 'running', gameTime: 12, mode: '1v1' }),
    capabilities: Object.freeze(['match', 'players', 'heroes']),
    players: Object.freeze([Object.freeze({
      id: '0',
      heroes: Object.freeze([Object.freeze({
        id: 'Hamg', name: 'Archmage', level: 1, abilities: Object.freeze([immutableAbility])
      })])
    })])
  });
  assert.equal(
    standardGameObjects.abilityCooldownsForState(immutableState),
    standardGameObjects.abilityCooldownsForState(immutableState)
  );

  assert.deepEqual(standardGame.dayNightState(0), {
    hour: 6,
    isDay: true,
    secondsIntoCycle: 0,
    cycleProgress: 0
  });
  assert.equal(standardGame.dayNightState(240).hour, 18);
  assert.equal(standardGame.dayNightState(240).isDay, false);
  assert.equal(standardGame.dayNightState(480).hour, 6);
});
