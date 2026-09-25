import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchHistory } from '../src/analytics.js';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';
import { validateState } from '../src/internal/protocol.js';
const stats = (time, used=0, sold=0) => ({ gameTime: time, goldMined: time*10, goldUpkeepLost: time*2, heroes: {},
  items: { tpot: { collected: 2, purchased: 1, used, sold, destroyed: 0 } } });
const state = (time, used=0, units=0, sold=0) => ({ capabilities: ['match','players','heroes','resources','units','buildings'], gameContext: { hudScale: 1 },
  match: { id: 'one', status: 'running', gameTime: time, mode: '1v1', isReplay: true, gameDataId: 'test' }, players: [{ id: '0',
    statistics: stats(time,used,sold), losses: { gameTime: time, units: { hfoo: units }, buildings: {}, complete: false } }] });
const catalog = { id: 'test', items: { get: () => ({ cost: { gold: 300, lumber: 0 }, initialCharges: 3 }) },
  units: { get: () => ({ cost: { gold: 135, lumber: 0 }, supply: { used: 2 } }) } };
const heroA = '0000000100000001', heroB = '0000000100000002';
const heroStats = (deaths, typeId = 'Hamg') => ({ typeId, deaths, totalKills: 0, heroKills: 0, selfKills: 0, buildingKills: 0, timeAliveMs: 0 });
const heroState = (time, heroes) => {
 const s = state(time); s.players[0].statistics.heroes = heroes; return s;
};
const heroWindow = (h, seconds = 30) => h.window('0', seconds, undefined, { kinds: ['hero-lost'] });

test('hero deaths retain instance identity, aggregate by type and exclude recruitment costs', () => {
 const h = createMatchHistory();
 h.push(heroState(0, { [heroA]: heroStats(2), [heroB]: heroStats(0) }));
 h.push(heroState(10, { [heroA]: heroStats(3), [heroB]: heroStats(2) }));
 const w = heroWindow(h);
 assert.deepEqual(w.events, [
  { playerId: '0', heroId: heroA, typeId: 'Hamg', kind: 'hero-lost', count: 1, fromGameTime: 0, gameTime: 10 },
  { playerId: '0', heroId: heroB, typeId: 'Hamg', kind: 'hero-lost', count: 2, fromGameTime: 0, gameTime: 10 }
 ]);
 assert.equal(w.counts['hero-lost'].Hamg, 3);
 assert.equal(w.covered, true); assert.equal(w.complete, true);
 assert.deepEqual(w.cost, { gold: 0, lumber: 0, food: 0 });
 assert.throws(() => { w.events[0].heroId = heroB; });
 const next = heroState(20, { [heroA]: heroStats(3), [heroB]: heroStats(3) });
 next.players[0].losses.units.hfoo = 1; h.push(next);
 assert.deepEqual(h.window('0', 30, catalog).cost, { gold: 135, lumber: 0, food: 2 });
 assert.equal(heroWindow(h, 5).boundaryUncertain, true);
 assert.equal(h.window('0', 30, catalog, { kinds: ['unit-lost'] }).events.length, 1);
});

test('new, missing and transferred heroes establish baselines without inventing deaths', () => {
 const h = createMatchHistory(); h.push(heroState(0, {}));
 h.push(heroState(1, { [heroA]: heroStats(3) }));
 assert.equal(heroWindow(h).events.length, 0); assert.equal(heroWindow(h).covered, false);
 h.push(heroState(2, { [heroA]: heroStats(4) }));
 h.push(heroState(3, {})); // Disappearance is not a death and does not erase real events.
 h.push(heroState(4, { [heroA]: heroStats(6) }));
 assert.equal(heroWindow(h).counts['hero-lost'].Hamg, 1);
 const transfer = heroState(5, {});
 transfer.players.push({ id: '1', statistics: { gameTime: 5, heroes: { [heroA]: heroStats(6) } } });
 h.push(transfer);
 assert.equal(h.window('1', 30, undefined, { kinds: ['hero-lost'] }).events.length, 0);
 transfer.match.gameTime = 6; transfer.players[1].statistics.gameTime = 6;
 transfer.players[1].statistics.heroes[heroA].deaths = 7; h.push(transfer);
 assert.equal(h.window('1', 1, undefined, { kinds: ['hero-lost'] }).counts['hero-lost'].Hamg, 1);
});

test('hero feed withdrawal, invalidity and staleness never backfill an outage', () => {
 for (const outage of ['missing', 'invalid', 'stale']) {
  const h = createMatchHistory(); h.push(heroState(0, { [heroA]: heroStats(0) }));
  h.push(heroState(1, { [heroA]: heroStats(1) }));
  const gap = heroState(8, { [heroA]: heroStats(2) });
  if (outage === 'missing') delete gap.players[0].statistics.heroes;
  if (outage === 'invalid') gap.players[0].statistics.heroes[heroA].deaths = -1;
  if (outage === 'stale') gap.players[0].statistics.gameTime = 1;
  h.push(gap); h.push(heroState(9, { [heroA]: heroStats(4) }));
  assert.equal(heroWindow(h).counts['hero-lost'].Hamg, 1);
  assert.equal(heroWindow(h).covered, false);
  h.push(heroState(10, { [heroA]: heroStats(5) }));
  assert.equal(heroWindow(h, 1).counts['hero-lost'].Hamg, 1);
  assert.equal(heroWindow(h, 1).covered, true);
 }
});

test('hero counter rollback and changed identity reset only affected hero history', () => {
 for (const replacement of [heroStats(0), heroStats(1, 'Hpal')]) {
  const h = createMatchHistory();
  h.push(heroState(0, { [heroA]: heroStats(0), [heroB]: heroStats(0) }));
  h.push(heroState(1, { [heroA]: heroStats(1), [heroB]: heroStats(1) }));
  const s = heroState(2, { [heroA]: replacement, [heroB]: heroStats(1) });
  s.players[0].losses.units.hfoo = 1; h.push(s);
  assert.deepEqual(heroWindow(h).events.map(e => e.heroId), [heroB]);
  assert.equal(heroWindow(h).covered, false);
  assert.equal(h.window('0', 30).counts['unit-lost'].hfoo, 1);
  h.push(heroState(0, { [heroA]: heroStats(0) }));
  assert.equal(heroWindow(h).events.length, 0);
 }
});

test('hero history enforces hero capability and self-play ownership, including direct snapshots', () => {
 const h = createMatchHistory();
 const self = (time, deaths) => {
  const s = heroState(time, { [heroA]: heroStats(deaths) });
  s.match.isReplay = false; s.match.realBroadcasterPlayerId = '0';
  s.players.push({ ...s.players[0], id: '1' }); return s;
 };
 h.push(self(0, 0)); h.push(self(1, 1));
 assert.equal(heroWindow(h).events.length, 1);
 assert.equal(h.window('1', 1, undefined, { kinds: ['hero-lost'] }).events.length, 0);
 for (const time of [2, 3]) {
  const s = self(time, time); s.capabilities = ['match', 'players', 'units']; h.push(s);
 }
 assert.equal(heroWindow(h).events.length, 0); assert.equal(heroWindow(h).covered, false);
 h.push(self(4, 4)); assert.equal(heroWindow(h).events.length, 0);
});

test('local recorder hero counters feed loss history with permissions intact', () => {
 const h = createMatchHistory();
 const baseline = state(0); delete baseline.players[0].statistics;
 for (const time of [0, 1]) {
  const updates = [{ class: 'W3PlayerStatistics', slotId: 0, matchId: 'one',
   statistics: { gameTime: time, heroes: { [heroA]: heroStats(time) } } }];
  baseline.match.gameTime = time;
  const projected = applyLocalRecorderUpdates(baseline, updates); validateState(projected); h.push(projected);
  const denied = applyLocalRecorderUpdates({ ...baseline, capabilities: ['match', 'players', 'units'] }, updates);
  assert.equal(denied.players[0].statistics?.heroes, undefined);
 }
 assert.equal(heroWindow(h).counts['hero-lost'].Hamg, 1);
});
test('observer counters produce bounded immutable windows and economic graph samples', () => {
 const h=createMatchHistory(); h.push(state(0)); h.push(state(30,1,2));
 const w=h.window('0',30,catalog);
 assert.equal(w.counts['item-used'].tpot,1); assert.equal(w.counts['unit-lost'].hfoo,2);
 assert.deepEqual(w.cost,{gold:370,lumber:0,food:4}); assert.equal(w.covered,true); assert.equal(w.complete,false);
 assert.deepEqual(h.economy('0').at(-1),{gameTime:30,goldMined:300,goldUpkeepLost:60,netGold:240});
 assert.throws(()=>w.events.push({})); assert.throws(()=>{w.counts['unit-lost'].hfoo=20;});
 h.push(state(31,1,2)); assert.equal(h.window('0',1).events.length,0);
 assert.equal(h.window('0',30).boundaryUncertain,true);
 assert.throws(()=>h.window('0',30,{...catalog,id:'wrong'}));
});
test('late attach, withdrawn data, replay rewind, counter regression, mode and permissions never invent history', () => {
 const h=createMatchHistory(); h.push(state(100,5,2)); assert.equal(h.window('0',30).events.length,0); assert.equal(h.window('0',30).covered,false);
 h.push(state(101,6,3)); assert.equal(h.window('0',30).events.length,2);
 h.push(state(10)); assert.equal(h.window('0',30).events.length,0); assert.equal(h.economy('0').length,1);
 h.push(state(11,1,1)); const missing=state(12); delete missing.players[0].statistics; h.push(missing);
 h.push(state(13,4,2)); assert.equal(h.window('0',30).counts['item-used'].tpot,1); assert.equal(h.window('0',30).covered,false);
 const noScopes=state(14,5,3); noScopes.capabilities=['match']; h.push(noScopes); assert.equal(h.window('0',30).events.length,0); assert.deepEqual(h.economy('0'),[]);
 const self=state(15); self.match.isReplay=false; h.push(self); assert.equal(h.window('0',30).covered,false);
});
test('sale losses use explicit refund and retention/counter rollbacks remain visible', () => {
 const h=createMatchHistory({maxEvents:1,maxSamples:2,maxSeconds:60}); h.push(state(0)); h.push(state(1,1,1,1));
 const sale=h.window('0',30,catalog,{kinds:['item-sold'],soldItemRefundRate:0.5});
 // Retention evicted the item events rather than misreporting complete history.
 assert.equal(sale.covered,false);
 const s=createMatchHistory();s.push(state(0));s.push(state(1,0,0,1));
 assert.equal(s.window('0',1,catalog,{kinds:['item-sold']}).cost.gold,null);
 assert.equal(s.window('0',1,catalog,{kinds:['item-sold'],soldItemRefundRate:0.5}).cost.gold,150);
 s.push(state(2));assert.equal(s.window('0',30).events.length,0);
 assert.throws(()=>createMatchHistory({maxEvents:0}));assert.throws(()=>s.window('0',-1));
});
test('local recorder projection gates analytics by match, mode and per-field capabilities', () => {
 const baseline=state(1); delete baseline.players[0].statistics;delete baseline.players[0].losses;
 const updates=[{class:'W3PlayerStatistics',slotId:0,matchId:'one',statistics:stats(2,1)},
 {class:'W3PlayerLosses',slotId:0,matchId:'one',losses:{gameTime:2,units:{hfoo:1},buildings:{hbar:1},complete:false}},
 {class:'W3MatchOutcomes',matchId:'one',outcomes:{0:'won'}}];
 let next=applyLocalRecorderUpdates(baseline,updates);validateState(next);
 assert.equal(next.match.outcomes['0'],'won');assert.equal(next.players[0].statistics.items.tpot.used,1);
 next=applyLocalRecorderUpdates({...baseline,capabilities:['match','resources','buildings']},updates);
 assert.equal(next.players[0].statistics.items,undefined);assert.equal(next.players[0].losses.units,undefined);
 assert.equal(next.players[0].losses.buildings.hbar,1);
 next=applyLocalRecorderUpdates({...baseline,match:{...baseline.match,isReplay:false}},updates);
 assert.equal(next.players[0].statistics,undefined);assert.deepEqual(next.match.outcomes,{});
 next=applyLocalRecorderUpdates(baseline,updates.map(u=>({...u,matchId:'other'})));assert.equal(next.players[0].losses,undefined);
 assert.throws(()=>validateState({...baseline,match:{...baseline.match,outcomes:{0:'victory'}}}));
 const invalid=state(1);invalid.players[0].statistics.items.tpot.used=-1;assert.throws(()=>validateState(invalid));
 next=applyLocalRecorderUpdates(state(2),[{...updates[0],statistics:null}]);assert.equal(next.players[0].statistics,undefined);
});

test('consuming the last charge does not count native item destruction as a second loss', () => {
 const h=createMatchHistory();h.push(state(0));
 const consumed=state(1,1);consumed.players[0].statistics.items.tpot.destroyed=1;
 h.push(consumed);const window=h.window('0',1,catalog);
 assert.equal(window.events.length,1);assert.equal(window.events[0].kind,'item-used');
 assert.equal(window.cost.gold,100);
});

test('self-play history accepts own data and excludes opponent data even in directly supplied snapshots',()=>{
 const h=createMatchHistory();const make=t=>{const s=state(t,t);s.match.isReplay=false;s.match.realBroadcasterPlayerId='0';s.players.push({...s.players[0],id:'1'});return s;};
 h.push(make(0));h.push(make(1));assert.equal(h.window('0',1).events.length,1);
 assert.equal(h.window('1',1).events.length,0);assert.deepEqual(h.economy('1'),[]);
});

test('withdrawn economy never compares a fresh player with an old opponent sample', () => {
 const h=createMatchHistory();
 const frame=(time, a, b) => ({
  capabilities:['match','players','resources'], gameContext:{hudScale:1},
  match:{id:'antoine',status:'running',gameTime:time,mode:'1v1',isReplay:true,gameDataId:'test'},
  players:[{id:'0',statistics:a},{id:'1',statistics:b}]
 });
 const gold=(time,value)=>({gameTime:time,goldMined:value,goldUpkeepLost:0});
 h.push(frame(201.05,gold(201.05,1770),gold(201.05,1840)));
 assert.equal(h.economy('0').at(-1).netGold-h.economy('1').at(-1).netGold,-70);
 // The native statistics object can still contain other lanes after gold is withdrawn.
 h.push(frame(203.2,gold(203.2,1790),{gameTime:203.2,units:{}}));
 assert.deepEqual(h.economy('1'),[]);
 h.push(frame(279.75,gold(279.75,2560),{gameTime:279.75,units:{}}));
 assert.equal(h.economy('0').at(-1).netGold,2560);
 assert.deepEqual(h.economy('1'),[]); // Cannot produce 2560 - stale 1840 = +720.
 h.push(frame(281,gold(281,2570),gold(281,2640)));
 assert.deepEqual(h.economy('1'),[{gameTime:281,goldMined:2640,goldUpkeepLost:0,netGold:2640}]);
 assert.equal(h.economy('0').at(-1).netGold-h.economy('1').at(-1).netGold,-70);
});

test('missing, invalid and frozen economy feeds reset independently and retain observed zero', () => {
 const h=createMatchHistory();
 const push=(time,statistics)=>h.push({...state(time),players:[{id:'0',statistics}]});
 const zero={gameTime:1,goldMined:0,goldUpkeepLost:0};
 push(1,zero);
 assert.equal(h.economy('0').at(-1).netGold,0);
 push(6,zero); assert.equal(h.economy('0').length,1);
 push(6.01,zero); assert.deepEqual(h.economy('0'),[]);
 for (const withdrawn of [undefined,{gameTime:10,goldMined:100},{gameTime:10,goldUpkeepLost:0},{gameTime:10,goldMined:-1,goldUpkeepLost:0}]) {
  push(9,{gameTime:9,goldMined:90,goldUpkeepLost:0});
  assert.equal(h.economy('0').length,1);
  push(10,withdrawn);assert.deepEqual(h.economy('0'),[]);
 }
 push(11,{gameTime:20,goldMined:100,goldUpkeepLost:0});
 assert.deepEqual(h.economy('0'),[]);
});
