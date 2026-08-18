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
  assert.equal(standardGameObjects.iconUrl('btnblood&ghostkey', { graphics: 'classic', baseUrl: 'http://localhost:8080/assets/' }), 'http://localhost:8080/assets/wc3/standard-game/v1/classic/icons/btnblood%26ghostkey.png');
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
  assert.equal(standardGame.raceName('night-elf'), 'Night Elf');
  assert.equal(standardGame.raceShortName('human'), 'HU');
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
  const observerMatch = { isObserver: true, broadcasterPlayerId: 'east' };

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
    standardGame.orderMatchTeams(teamPlayers, { isObserver: true, broadcasterPlayerId: 'me' })
      .map(team => team.players.map(player => player.id)),
    [['me', 'ally'], ['opponent', 'opponent-ally']]
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
  const state = {
    match: { id: 'match', status: 'running', gameTime: 12, mode: '1v1' },
    capabilities: ['match', 'players', 'heroes'],
    players: [{ id: '0', heroes: [{ id: 'Hamg', name: 'Archmage', level: 1, abilities: [
      { id: 'AHbz', name: 'AHbz', level: 1, lastActivation: 10_000 }
    ] }] }]
  };
  assert.deepEqual(
    standardGameObjects.abilityCooldownsForState(state).get(state.players[0].heroes[0].abilities[0]),
    { total: 6, elapsed: 2, remaining: 4, progress: 1 / 3, active: true }
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
