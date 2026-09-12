import test from 'node:test';
import { webcrypto } from 'node:crypto';
// Node 18's test runner needs the browser Web Crypto environment supplied.
globalThis.crypto ??= webcrypto;
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadGameData, abilityCooldown, abilityCooldownsForState } from '../src/game-data.js';

// Generated current-game source excerpt; fixtures never enter the published SDK.
const fixture = JSON.parse(await readFile(new URL('./fixtures/game-data.json', import.meta.url)));
const id = '2.0.4.23745-0123456789abcdef';
function server(corrupt = false) {
  const requests = [];
  const bytes = JSON.stringify(fixture.catalog);
  const gameplay = JSON.stringify(fixture.gameplay);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const manifest = { schemaVersion: 1, id, gameVersion: '2.0.4.23745', ruleset: 'current-melee', files: {
    'catalog.json': { sha256: digest(bytes) }, 'unit-gameplay.json': { sha256: digest(gameplay) }
  } };
  return { requests, fetch: async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, 'omit');
    return new Response(url.endsWith('manifest.json') ? JSON.stringify(manifest) : url.endsWith('unit-gameplay.json') ? gameplay : bytes + (corrupt ? ' ' : ''));
  } };
}
test('generated rawcodes join type stats, graphics and ordered upgrade levels', async () => {
  const http = server();
  const data = await loadGameData(id, { fetch: http.fetch, baseUrl: 'https://example.test/assets' });
  assert.equal(http.requests.length, 2);
  assert.equal(data.units.get('hfoo').cost.gold, 135);
  assert.equal(data.units.get('hfoo').supply.used, 2);
  assert.equal(data.units.get('hfoo').baseStats.hitpoints, 420);
  assert.deepEqual(data.upgrades.get('Rhar').levels.map(level => level.cost.gold), [125, 150, 175]);
  const images = [1, 2, 3].map(level => data.assets.upgradeIcon('Rhar', { graphics: 'classic', level }));
  assert.equal(new Set(images).size, 3);
  assert.ok(images.every(url => /^https:\/\/example.test\/assets\/wc3\/images\/[a-f0-9]{64}\.png$/.test(url)));
  assert.equal(data.assets.upgradeIcon('Rhar3', { graphics: 'classic', level: 3 }), undefined);
  assert.equal(data.assets.upgradeIcon('Rhar', { graphics: 'classic', level: 4 }), undefined);
  assert.equal(data.units.get('HFOO'), undefined);
  assert.equal(data.assets.unitIcon('ZZZZ', { graphics: 'classic' }), undefined);
  assert.notEqual(data.assets.unitIcon('hfoo', { graphics: 'classic' }), data.assets.unitIcon('hfoo', { graphics: 'reforged' }));
  assert.equal('artwork' in data.units.get('hfoo'), false);
  assert.throws(() => { data.units.get('hfoo').cost.gold = 0; }, TypeError);
  assert.equal(await loadGameData(id, { fetch: http.fetch, baseUrl: 'https://example.test/assets' }), data);
  assert.equal(http.requests.length, 2);
  const broad = await data.unitGameplay('hfoo');
  assert.ok(Object.keys(broad).length > 0);
  assert.equal(http.requests.length, 3);
  await data.unitGameplay('hfoo');
  assert.equal(http.requests.length, 3);
});
test('revision, integrity and abort failures never silently select another catalog', async () => {
  await assert.rejects(loadGameData('current'), /gameDataId/);
  await assert.rejects(loadGameData(id, { fetch: server(true).fetch }), /checksum/);
  const http = server();
  await assert.rejects(loadGameData(id, { fetch: http.fetch, signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(http.requests.length, 0);
  await assert.rejects(loadGameData('2.0.4.23745-1111111111111111', { fetch: http.fetch }), /revision mismatch/);
});
test('cooldowns use observed ability levels and only a matching match revision', async () => {
  const data = await loadGameData(id, { fetch: server().fetch });
  const ability = { id: 'instance-ability', typeId: 'AHbz', level: 1, lastActivation: 10000 };
  assert.deepEqual(abilityCooldown(ability, 12, data), { totalSeconds: 6, remainingSeconds: 4, progress: 1 / 3, active: true });
  assert.equal(abilityCooldown({ ...ability, level: 0 }, 12, data), undefined);
  const state = { match: { status: 'running', gameTime: 12, gameDataId: id }, players: [{ heroes: { hero: { abilities: [ability] } } }] };
  const result = abilityCooldownsForState(state, data);
  assert.equal(result.size, 1);
  assert.equal(result.set, undefined);
  result.forEach((value, key, map) => { assert.equal(key, ability); assert.equal(map, result); });
  assert.equal(abilityCooldownsForState({ ...state, match: { ...state.match, gameDataId: 'other' } }, data).size, 0);
});
