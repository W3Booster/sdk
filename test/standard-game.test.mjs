import test from 'node:test';
import assert from 'node:assert/strict';
import * as standardGame from '../src/standard-game.js';

test('standard-game namespace exposes shipped object metadata without changing core imports', () => {
  assert.equal(standardGame.getIcon('Hamg'), 'btnheroarchmage.png');
  assert.equal(standardGame.iconFileName('Hamg'), 'btnheroarchmage.png');
  assert.equal(standardGame.iconUrl('Hamg'), 'https://assets.w3booster.com/wc3/standard-game/v1/reforged/icons/btnheroarchmage.png');
  assert.equal(standardGame.iconUrl('btnblood&ghostkey', { graphics: 'classic', baseUrl: 'http://localhost:8080/assets/' }), 'http://localhost:8080/assets/wc3/standard-game/v1/classic/icons/btnblood%26ghostkey.png');
  assert.equal(standardGame.iconUrl('../secret'), undefined);
  assert.equal(standardGame.assetManifestUrl(), 'https://assets.w3booster.com/wc3/standard-game/v1/manifest.json');
  assert.equal(standardGame.getAbilityCooldown('AHbz', 2), 6);
  assert.equal(standardGame.getObject('custom-map-object'), undefined);
  assert.equal(standardGame.getObject('__proto__'), undefined);
  assert.equal(standardGame.getObject('toString'), undefined);
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
});

test('standard-game metadata is immutable shared data', () => {
  assert.equal(Object.isFrozen(standardGame.objects), true);
  assert.equal(Object.isFrozen(standardGame.getObject('Hamg')), true);
});

test('standard-game derives upgrade categories and statistics without application presentation rules', () => {
  const broadcaster = { id: 'me', team: 0, colorId: 0, stats: { solo: { wins: 4, losses: 2, winRate: 0.67 } } };
  assert.equal(standardGame.normalizeUpgradeRawcode('Rema3'), 'Rema');
  assert.equal(standardGame.getIcon('Rema3'), standardGame.getIcon('Rema'));
  assert.equal(standardGame.isWeaponOrArmorUpgrade('Rema3'), true);
  assert.equal(standardGame.isWeaponOrArmorUpgrade('Rhde'), false);
  assert.equal(standardGame.statsForMode(broadcaster, '1v1')?.wins, 4);
});

test('standard-game owns cooldown timestamp and day/night clock semantics', () => {
  assert.deepEqual(standardGame.abilityCooldown(
    { id: 'AHbz', name: 'AHbz', level: 1, lastActivation: 10_000 },
    12
  ), { total: 6, elapsed: 2, remaining: 4, progress: 1 / 3, active: true });
  assert.equal(standardGame.abilityCooldown({ id: 'AHbz', name: 'AHbz', level: 1 }, 12), undefined);

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
