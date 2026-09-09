import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';
import { validateState, supportsProtocolVersion } from '../src/internal/protocol.js';
import { playerUnits, playerHeroes, playerBuildings } from '../src/selectors.js';
import { emitDomainEvents } from '../src/internal/domain.js';
import { deepFreeze } from '../src/internal/values.js';
const id = n => n.toString(16).padStart(16, '0');
const baseline = (caps = ['match', 'heroes', 'units', 'buildings', 'production']) => ({
  match: { id: '42', status: 'running', gameTime: 1, mode: '1v1', isReplay: true, broadcasterPlayerId: '0' },
  gameContext: { hudScale: 1 }, capabilities: caps,
  players: [{ id: '0', units: {}, heroes: {}, buildings: {} }, { id: '1', units: {}, heroes: {}, buildings: {} }]
});
const hp = (n, typeId = 'hfoo', targetFlags = 2, extra = {}) => ({
  class: 'W3UnitHealth', matchId: 42, id: id(n), typeId, slotId: 0, targetFlags,
  hitpoints: { current: 250, max: 420 }, ...extra
});
const queue = (n, entries = ['hfoo', 'hfoo'], extra = {}) => ({
  class: 'W3ProductionQueue', matchId: 42, id: id(n), typeId: 'hbar', slotId: 0,
  queue: entries.map((typeId, position) => ({ typeId, position, progress: null })), ...extra
});
const hero = (n, typeId = 'Hamg', extra = {}) => ({ class: 'W3Unit', matchId: 42, id: id(n), typeId,
  slotId: 0, isHero: true, experience: 500, inventory: ['', 'ratf', 'ratf'], ...extra });
const apply = (state, updates) => {
  const next = applyLocalRecorderUpdates(state, updates);
  validateState(next, undefined, false);
  return next;
};
test('instances split exclusively into ordinary units, heroes and structures, independent of queue presence', () => {
  const state = apply(baseline(), [hp(1), hp(2), hp(3, 'hgyr', 4), hp(4, 'hhou', 8), hp(5, 'Hamg'), hp(6, 'Hamg')]);
  assert.deepEqual(Object.keys(state.players[0].units), [id(1), id(2), id(3)]);
  assert.deepEqual(Object.keys(state.players[0].buildings), [id(4)]);
  assert.deepEqual(Object.keys(state.players[0].heroes), [id(5), id(6)]);
  assert.equal(state.players[0].heroes[id(5)].experience, undefined);
  assert.equal(state.players[0].buildings[id(4)].production, undefined);
  assert.equal(state.players[0].buildings[id(4)].construction, undefined);
});
test('health and queue snapshots merge in either order, retain duplicates, and invalidate only their own fields', () => {
  for (const updates of [[hp(1, 'hbar', 8), queue(1)], [queue(1), hp(1, 'hbar', 8)]]) {
    let state = apply(baseline(), updates);
    const building = state.players[0].buildings[id(1)];
    assert.equal(building.production.queue.length, 2);
    assert.equal(building.production.queue[0].progress, null);
    assert.equal(building.hitpoints.current, 250);
    state = apply(state, [queue(1, [])]);
    assert.deepEqual(state.players[0].buildings[id(1)].production.queue, []);
    state = apply(state, [queue(1, [], { removed: true })]);
    assert.equal(state.players[0].buildings[id(1)].production, undefined);
    assert.equal(state.players[0].buildings[id(1)].hitpoints.current, 250);
    state = apply(state, [hp(1, 'hbar', 8, { removed: true })]);
    assert.deepEqual(state.players[0].buildings, {});
  }
});
test('XP, inventory and vitals associate by instance even for two heroes of the same type', () => {
  for (const updates of [[hero(1), hp(1, 'Hamg')], [hp(1, 'Hamg'), hero(1)]]) {
    let state = apply(baseline(), [...updates, hero(2), hp(2, 'Hamg', 2, { mana: { current: 50, max: 300 } })]);
    state = apply(state, [hp(1, 'Hamg', 2, { hitpoints: { current: 100, max: 500 } })]);
    assert.equal(state.players[0].heroes[id(1)].experience, 500);
    assert.equal(state.players[0].heroes[id(2)].hitpoints.current, 250);
    assert.deepEqual(state.players[0].heroes[id(1)].inventory, ['', 'ratf', 'ratf']);
    state = apply(state, [hp(2, 'Hamg')]);
    assert.equal(state.players[0].heroes[id(2)].mana, undefined);
    state = apply(state, [hero(1, 'Edmm')]);
    assert.equal(state.players[0].heroes[id(1)].typeId, 'Edmm');
    assert.equal(Object.keys(state.players[0].heroes).length, 2);
    state = apply(state, [hero(1, 'Edmm', { removed: true })]);
    assert.equal(state.players[0].heroes[id(1)], undefined);
  }
});
test('ownership and category changes remove the old membership; stale owner removals cannot erase the new instance', () => {
  let state = apply(baseline(), [hp(1, 'hbar', 8), queue(1)]);
  state = apply(state, [hp(1, 'hbar', 8, { slotId: 1 }), queue(1, [], { slotId: 1 })]);
  state = apply(state, [hp(1, 'hbar', 8, { removed: true }), queue(1, [], { removed: true })]);
  assert.deepEqual(state.players[0].buildings, {});
  assert.equal(state.players[1].buildings[id(1)].hitpoints.current, 250);
  state = apply(state, [hp(1, 'hfoo', 2, { slotId: 1 })]);
  assert.deepEqual(state.players[1].buildings, {});
  assert.equal(state.players[1].units[id(1)].typeId, 'hfoo');
});
test('scopes cannot reveal hero health through ordinary units or building identity grants', () => {
  const state = apply(baseline(['match', 'units', 'production']), [hp(1, 'Hamg'), hero(1), hp(2, 'hbar', 8), queue(2), hp(3)]);
  assert.deepEqual(state.players[0].heroes, {});
  assert.equal(state.players[0].buildings[id(2)].hitpoints, undefined);
  assert.equal(state.players[0].buildings[id(2)].production.queue.length, 2);
  assert.equal(state.players[0].units[id(3)].hitpoints.current, 250);
});
test('ordinary games exclude opponents; replay accepts participating owners and rejects neutrals and stale matches', () => {
  let normal = baseline(); normal.match.isReplay = false;
  normal = apply(normal, [hp(1), hp(2, 'hfoo', 2, { slotId: 1 })]);
  assert.equal(Object.keys(normal.players[0].units).length, 1);
  assert.deepEqual(normal.players[1].units, {});
  const replay = apply(baseline(), [hp(1, 'hfoo', 2, { slotId: 1 }), hp(2, 'hfoo', 2, { slotId: 24 }), hp(3, 'hfoo', 2, { matchId: 41 })]);
  assert.deepEqual(Object.keys(replay.players[1].units), [id(1)]);
  assert.deepEqual(replay.players[0].units, {});
});
test('unchanged observations preserve state and selector identity; changes do not mutate old snapshots', () => {
  const first = deepFreeze(apply(baseline(), [hp(1), hp(2), hero(3), hp(4, 'hhou', 8)]));
  assert.equal(apply(first, [hp(1)]), first);
  const units = playerUnits(first.players[0]);
  assert.equal(playerUnits(first.players[0]), units);
  assert.equal(playerHeroes(first.players[0]), playerHeroes(first.players[0]));
  assert.equal(playerBuildings(first.players[0]), playerBuildings(first.players[0]));
  assert.ok(Object.isFrozen(units));
  const next = apply(first, [hp(1, 'hfoo', 2, { hitpoints: { current: 10, max: 420 } })]);
  assert.equal(next.players[0].units[id(2)], first.players[0].units[id(2)]);
  assert.equal(first.players[0].units[id(1)].hitpoints.current, 250);
  assert.equal(next.players[0].heroes, first.players[0].heroes);
});
test('protocol rejects old hero arrays, mismatched IDs, duplicate ownership, impossible pools and queue progress', () => {
  assert.equal(supportsProtocolVersion('2.0'), false);
  assert.equal(supportsProtocolVersion('3.99'), true);
  const first = apply(baseline(), [hp(1), hero(2), hp(3, 'hbar', 8), queue(3)]);
  for (const mutate of [
    state => { state.players[0].heroes = Object.values(state.players[0].heroes); },
    state => { state.players[0].units[id(1)].id = id(2); },
    state => { state.players[1].units[id(1)] = state.players[0].units[id(1)]; },
    state => { state.players[0].units[id(1)].hitpoints.current = 10000; },
    state => { state.players[0].buildings[id(3)].production.queue[0].progress = 50; }
  ]) { const state = structuredClone(first); mutate(state); assert.throws(() => validateState(state), /INVALID_STATE|instance|Unit|production|hitpoints/); }
});
test('hero events use instance IDs and distinguish two heroes of the same type', () => {
  const first = apply(baseline(), [hero(1), hero(2)]);
  const next = apply(first, [hero(2, 'Hamg', { experience: 1000 })]);
  const events = []; emitDomainEvents(first, next, (type, data) => events.push({ type, data }));
  const heroes = events.filter(event => event.type === 'hero.changed');
  assert.equal(heroes.length, 1); assert.equal(heroes[0].data.heroId, id(2));
});
test('hero positions, one-time structure positions and construction progress preserve independent production', () => {
  const construction = hp(1, 'hbar', 8, { position: { x: -300, y: 120 }, construction: { progress: 0.4 } });
  const heroPosition = hp(2, 'Hamg', 2, { position: { x: 12.5, y: -45 } });
  const production = queue(1, [], { queue: [{ position: 0, typeId: 'hfoo', progress: 0.25 }, { position: 1, typeId: 'hfoo', progress: 0 }] });
  let state = apply(baseline(), [construction, heroPosition, production]);
  assert.equal(state.players[0].buildings[id(1)].construction.progress, 0.4);
  assert.equal(state.players[0].buildings[id(1)].production.queue[0].progress, 0.25);
  assert.equal(apply(state, [construction, heroPosition, production]), state);
  const previous = deepFreeze(state);
  state = apply(state, [{ ...construction, construction: { progress: null } }, { ...heroPosition, position: { x: 90, y: -45 } }]);
  assert.equal(state.players[0].buildings[id(1)].construction.progress, null);
  assert.equal(state.players[0].buildings[id(1)].position, previous.players[0].buildings[id(1)].position);
  assert.equal(state.players[0].buildings[id(1)].production, previous.players[0].buildings[id(1)].production);
  assert.equal(previous.players[0].heroes[id(2)].position.x, 12.5);
  assert.equal(state.players[0].heroes[id(2)].position.x, 90);
  state = apply(state, [{ ...construction, construction: undefined }]);
  assert.equal(state.players[0].buildings[id(1)].construction, undefined);
  assert.deepEqual(state.players[0].buildings[id(1)].position, { x: -300, y: 120 });
  assert.equal(state.players[0].buildings[id(1)].production.queue.length, 2);
  state = apply(state, [{ ...heroPosition, position: undefined }]);
  assert.equal(state.players[0].heroes[id(2)].position, undefined);
  for (const invalid of [hp(3, 'hfoo', 2, { position: { x: 0, y: 0 } }),
    hp(3, 'Hamg', 2, { construction: { progress: 0.1 } }),
    hp(3, 'hbar', 8, { construction: { progress: 1.1 } }),
    hp(3, 'hbar', 8, { position: { x: Infinity, y: 0 } })]) assert.equal(apply(state, [invalid]), state);
});

test('production preserves observed seconds without inventing timers for waiting or older snapshots', () => {
  const update = queue(1, [], { queue: [
    { position: 0, typeId: 'hfoo', progress: 0.25, remainingSeconds: 15.125, totalSeconds: 20 },
    { position: 1, typeId: 'hfoo', progress: 0, remainingSeconds: null, totalSeconds: null }
  ] });
  const state = apply(baseline(), [update]);
  assert.equal(state.players[0].buildings[id(1)].production.queue[0].remainingSeconds, 15.125);
  assert.equal(state.players[0].buildings[id(1)].production.queue[0].totalSeconds, 20);
  assert.equal(state.players[0].buildings[id(1)].production.queue[1].remainingSeconds, null);
  const unchanged = apply(state, [update]);
  assert.equal(unchanged.players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
  for (const remainingSeconds of [0, null, undefined]) {
    const next = apply(state, [{ ...update, queue: [{ position: 0, typeId: 'hfoo', progress: 0.25, remainingSeconds }] }]);
    assert.equal(next.players[0].buildings[id(1)].production.queue[0].remainingSeconds, remainingSeconds);
  }
  for (const remainingSeconds of [-1, Infinity, NaN, '15']) {
    const bad = { ...update, queue: [{ position: 0, typeId: 'hfoo', progress: 0.25, remainingSeconds }] };
    assert.equal(apply(state, [bad]).players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
    const snapshot = structuredClone(state); snapshot.players[0].buildings[id(1)].production.queue = bad.queue;
    assert.throws(() => validateState(snapshot), /invalid|finite/i);
  }
  for (const totalSeconds of [0, -1, 10, Infinity, NaN, '20']) {
    const bad = { ...update, queue: [{ ...update.queue[0], totalSeconds }] };
    assert.equal(apply(state, [bad]).players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
    const snapshot = structuredClone(state); snapshot.players[0].buildings[id(1)].production.queue = bad.queue;
    assert.throws(() => validateState(snapshot), /invalid|finite/i);
  }
  const badWaiting = { ...update, queue: update.queue.map(slot => ({ ...slot, remainingSeconds: 5 })) };
  assert.equal(apply(state, [badWaiting]).players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
});
