import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnitHistory } from '../src/analytics.js';
import { currentPlatformStats, currentStatsProvider } from '../src/selectors.js';
const id = '0000000100000001';
const unit = (damage, typeId = 'hfoo') => ({ typeId, alive: true, damageDealt: damage, damageReceived: damage / 2, healingDone: damage / 4 });
const state = (time, instances = { [id]: unit(time * 10) }, extra = {}) => ({ capabilities: ['units'],
  match: { id: 'one', status: 'running', gameTime: time, mode: '1v1', isReplay: true, ...extra },
  players: [{ id: '0', statistics: { gameTime: time, unitInstances: instances } }] });
test('initial counters baseline; contributions survive disappearance and timed-event expiry', () => {
  const h = createUnitHistory({ maxSeconds: 5 });
  h.push(state(10)); h.push(state(12));
  assert.equal(h.contributions({ unitId: id }).damageDealt, 20);
  assert.equal(h.contributions({ playerId: '0', typeId: 'hfoo' }).healingDone, 5);
  assert.equal(h.window(2).covered, true);
  assert.equal(h.window(1).boundaryUncertain, true);
  h.push(state(20, {}));
  assert.equal(h.contributions().damageDealt, 20);
  assert.equal(h.window(10).covered, false);
  assert.equal(h.window(5).damageDealt, 0);
  h.push(state(21)); h.push(state(22));
  assert.equal(h.contributions().damageDealt, 30, 'returning instance establishes a new baseline');
  assert.throws(() => { h.contributions().damageDealt = 1; });
});
test('gaps, counter resets, ownership and type changes do not invent contribution', () => {
  const h = createUnitHistory();
  h.push(state(0)); h.push(state(1));
  const missing = state(2); delete missing.players[0].statistics.unitInstances; h.push(missing);
  h.push(state(3)); assert.equal(h.window(3).covered, false);
  h.push(state(4, { [id]: unit(1) })); h.push(state(5, { [id]: unit(100, 'hkni') }));
  const transfer = state(6, {}); transfer.players.push({ id: '1', statistics: { gameTime: 6, unitInstances: { [id]: unit(110, 'hkni') } } }); h.push(transfer);
  transfer.match.gameTime = 7; transfer.players[0].statistics.gameTime = 7;
  transfer.players[1].statistics.gameTime = 7; transfer.players[1].statistics.unitInstances[id] = unit(120, 'hkni'); h.push(transfer);
  assert.equal(h.contributions({ playerId: '0' }).damageDealt, 10);
  assert.equal(h.contributions({ playerId: '1' }).damageDealt, 10);
  assert.equal(h.contributions({ typeId: 'hkni' }).damageDealt, 10);
});
test('permission, match and rewind resets and explicit disconnect reset', () => {
  for (const change of [{ id: 'two' }, { gameTime: 0 }, { isReplay: false }]) {
    const h = createUnitHistory(); h.push(state(0)); h.push(state(1)); h.push(state(2, undefined, change));
    assert.equal(h.contributions().damageDealt, 0);
  }
  const h = createUnitHistory(); h.push(state(0)); h.push(state(1));
  const denied = state(2); denied.capabilities = []; h.push(denied);
  assert.equal(h.contributions().damageDealt, 0);
  h.push(state(3)); h.push(state(4)); h.reset(); assert.equal(h.contributions().damageDealt, 0);
});
test('bounded capacity is explicit and accelerated replay/frozen receipts obey freshness', () => {
  let wall = 0; const h = createUnitHistory({ maxUnits: 1, maxEvents: 1, now: () => wall });
  h.push(state(0, { [id]: unit(0) }, { gameSpeed: 64 })); wall = 500;
  h.push(state(32, { [id]: unit(100) }, { gameSpeed: 64 }));
  assert.equal(h.window(32).damageDealt, 100);
  h.push(state(33, { [id]: unit(110), '0000000100000002': unit(10) }));
  assert.equal(h.contributions().truncated, true);
  assert.equal(h.window(33).covered, false);
  wall = 6500; h.push(state(34, { [id]: unit(500) }));
  assert.equal(h.contributions().damageDealt, 110, 'silent real-time gap must not backfill');
});
test('current platform selection is explicit and never falls back', () => {
  const bnet = { provider: 'bnet', mmr: 3200 }, w3c = { provider: 'w3champions', mmr: 1800 };
  const player = { stats: { records: [w3c, bnet] } };
  assert.deepEqual(currentPlatformStats({ realm: 'Reforged' }, player), [bnet]);
  assert.deepEqual(currentPlatformStats({ realm: 'W3Champions@EU' }, player), [w3c]);
  assert.deepEqual(currentPlatformStats({ realm: 'Reforged' }, { stats: { records: [w3c] } }), []);
  assert.equal(currentStatsProvider({ realm: 'Battle.net' }), 'bnet');
  assert.equal(currentStatsProvider({ realm: 'unknown' }), undefined);
});

test('duplicate identities, malformed counters and frozen feeds never invent contributions', () => {
  let wall=0; const h=createUnitHistory({now:()=>wall});
  h.push(state(0));h.push(state(1));
  const duplicate=state(2);duplicate.players.push({id:'1',statistics:duplicate.players[0].statistics});
  h.push(duplicate);assert.equal(h.contributions().damageDealt,10);assert.equal(h.window(2).covered,false);
  const invalid=state(3);invalid.players[0].statistics.unitInstances[id].damageDealt=NaN;
  h.push(invalid);h.push(state(4));assert.equal(h.contributions().damageDealt,10);
  const frozen=state(4);frozen.match.gameTime=8;h.push(frozen);wall=6000;frozen.match.gameTime=9;h.push(frozen);
  assert.equal(h.window(5).covered,false);
  h.push(state(10));assert.equal(h.contributions().damageDealt,10);
});
test('pauses suspend receipt aging; new rate observations shed old fast-play allowances', () => {
  let wall=0;const h=createUnitHistory({now:()=>wall});
  h.push(state(0,undefined,{paused:true,gameSpeed:64}));wall=60000;
  h.push(state(0,undefined,{paused:false,gameSpeed:64}));wall+=500;
  h.push(state(32,undefined,{gameSpeed:64}));assert.equal(h.contributions().damageDealt,320);
  wall+=2000;h.push(state(34,undefined,{gameSpeed:1}));
  const frozen=state(34);frozen.match.gameTime=40;h.push(frozen);
  assert.equal(h.window(6).covered,false,'a newly observed slow sample must not inherit the match-long 64x rate');
});

test('retained entries support app-side counts and grouping, including zero-contribution units', () => {
 const h=createUnitHistory(); const other='0000000100000002';
 h.push(state(0,{[id]:unit(0),[other]:unit(0,'hkni')}));
 assert.equal(h.entries().length,2);
 h.push(state(1,{[id]:{...unit(10),alive:false}}));
 const old=h.entries({unitId:other})[0];assert.equal(old.present,false);assert.equal(old.alive,true);
 assert.equal(h.entries({typeId:'hfoo'})[0].damageDealt,10);
 assert.equal(h.entries({typeId:'hfoo'})[0].alive,false);
 const missing=state(2);delete missing.players[0].statistics.unitInstances;h.push(missing);
 assert.equal(h.entries({unitId:id})[0].present,undefined);
 assert.equal(h.entries().length,2);
 assert.throws(()=>{h.entries()[0].alive=true;});
});
