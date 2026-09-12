import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentField, packSources, unpackSources } from '../scripts/unit-catalog/format.mjs';
import { projectGameplay } from '../scripts/unit-catalog/policy.mjs';

test('source compaction preserves missing, empty, sentinel and numeric-looking string values', () => {
  const sources = {
    balance: {
      hfoo: { cost: '135', supply: '2', empty: '', sentinel: ' - ', id: '0001' },
      hrif: { cost: '205', supply: '3', sentinel: '_', id: '0002' },
      Hamg: { cost: '400', supply: '5', empty: '', sentinel: '-', id: '0003' },
      H000: {},
    },
    profiles: { hfoo: { tip: 'Semicolon; comma, quote " and |n\\path', unicode: 'Grüße' } },
    empty: {},
  };
  const artifact = JSON.parse(JSON.stringify(packSources(sources)));
  assert.deepEqual(unpackSources(artifact), sources);
  assert.equal(Object.hasOwn(unpackSources(artifact).balance.hrif, 'empty'), false);
});

test('packing is deterministic regardless of input insertion order', () => {
  const first = { a: { hfoo: { z: '0', a: '1' }, hrif: { a: '0', z: '1' } }, b: {} };
  const reordered = { b: {}, a: { hrif: { z: '1', a: '0' }, hfoo: { a: '1', z: '0' } } };
  assert.deepEqual(packSources(first), packSources(reordered));
});

test('current filtering removes legacy qualifiers and retains graphics and current overrides', () => {
  for (const key of ['Name:custom,V0', 'Name:custom,V1', 'Art:hd:melee,V0', 'Name:custom,hd,V0']) {
    assert.equal(isCurrentField(key), false, key);
  }
  for (const key of ['HP', 'modelScale:sd', 'modelScale:SD', 'modelScale:hd', 'Tip:melee,V1']) {
    assert.equal(isCurrentField(key), true, key);
  }
  assert.throws(() => isCurrentField('HP:melee,V2'), /Unrecognized balance/);
  assert.throws(() => isCurrentField('HP:V0'), /Unrecognized balance/);
});

test('packing refuses implicit value conversion', () => {
  assert.throws(() => packSources({ balance: { hfoo: { cost: 135 } } }), /must be strings/);
});

test('gameplay projection keeps combat and economy mechanics while dropping presentation and calculated columns', () => {
  const { gameplay, droppedFields } = projectGameplay({
    'tables/unitbalance': { Hamg: { HP: '100', realHP: '450', STR: '14', goldcost: '400', stockRegen: '110' } },
    'tables/unitweapons': { Hamg: { dmgplus1: '21', backSw1: '0.85', DPS: 'stale', comment: 'unused' } },
    'profiles/units/humanunitfunc.txt': { Hamg: { Requires1: 'hkee', Missilespeed: '900', Missileart: 'model.mdl' } },
    'profiles/_locales/enus.w3mod/units/humanunitstrings.txt': { Hamg: { Name: 'Archmage', Ubertip: 'Long description' } },
    'profiles/units/unitskin.txt': { Hamg: { file: 'model.mdl', scale: '1' } },
  });
  assert.deepEqual(gameplay, {
    'tables/unitbalance': { Hamg: { HP: '100', STR: '14', goldcost: '400', stockRegen: '110' } },
    'tables/unitweapons': { Hamg: { dmgplus1: '21', backSw1: '0.85' } },
    'profiles/units/humanunitfunc.txt': { Hamg: { Requires1: 'hkee', Missilespeed: '900' } },
    'profiles/_locales/enus.w3mod/units/humanunitstrings.txt': { Hamg: { Name: 'Archmage' } },
  });
  assert.deepEqual(droppedFields['tables/unitbalance'], ['realHP']);
  assert.deepEqual(unpackSources(packSources(gameplay)), gameplay);
});
