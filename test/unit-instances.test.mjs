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
  class: 'W3UnitHealth', matchId: 42, id: id(n), typeId, isIllusion: false, slotId: 0, targetFlags,
  hitpoints: { current: 250, max: 420 }, ...extra
});
const queue = (n, entries = ['hfoo', 'hfoo'], extra = {}) => ({
  class: 'W3ProductionQueue', matchId: 42, id: id(n), typeId: 'hbar', isIllusion: false, slotId: 0,
  queue: entries.map((typeId, position) => ({ typeId, position, progress: null, remainingSeconds: null, totalSeconds: null })), ...extra
});
const hero = (n, typeId = 'Hamg', extra = {}) => ({ class: 'W3Unit', matchId: 42, id: id(n), typeId, isIllusion: false,
  slotId: 0, isHero: true, experience: 500, inventory: ['', 'ratf', 'ratf'], ...extra });
const apply = (state, updates) => {
  const next = applyLocalRecorderUpdates(state, updates);
  validateState(next, undefined, false);
  return next;
};
test('unit selectors order complete IDs deterministically across snapshot permutations without numeric precision loss', () => {
  const ids = ['0020000000000000', '0020000000000001', '0020000080000000'];
  for (const [collection, select] of [['units', playerUnits], ['heroes', playerHeroes], ['buildings', playerBuildings]]) {
    const values = ids.map((id, index) => Object.freeze({ id, typeId: 'Hmkg', isIllusion: index === 1 }));
    for (const permutation of [[2, 1, 0], [0, 2, 1], [1, 0, 2]]) {
      const map = Object.freeze(Object.fromEntries(permutation.map(i => [ids[i], values[i]])));
      const player = Object.freeze({ [collection]: map });
      assert.deepEqual(select(player).map(unit => unit.id), [ids[0], ids[2]]);
      const all = select(player, { includeIllusions: true });
      assert.deepEqual(all, values);
      assert.equal(all[0], values[0]);
      assert.equal(select(player, { includeIllusions: true }), all);
      assert.ok(Object.isFrozen(all));
      assert.deepEqual(Object.keys(map), permutation.map(i => ids[i]), 'Raw snapshots must remain untouched');
    }
  }
});
test('hero health removal, recovery and changed XP cannot swap surviving hero identities', () => {
  let state = apply(baseline(), [hero(1), hero(2), hero(3), hp(1, 'Hamg'), hp(2, 'Hamg'), hp(3, 'Hamg')]);
  const order = () => playerHeroes(state.players[0]).map(unit => unit.id);
  assert.deepEqual(order(), [id(1), id(2), id(3)]);
  state = apply(state, [hp(2, 'Hamg', 2, { removed: true })]);
  assert.deepEqual(order(), [id(1), id(2), id(3)]);
  state = apply(state, [hero(2, 'Hamg', { removed: true })]);
  assert.deepEqual(order(), [id(1), id(3)]);
  state = apply(state, [hero(2, 'Hamg', { experience: 9000 }), hp(2, 'Hamg')]);
  assert.deepEqual(Object.keys(state.players[0].heroes), [id(1), id(3), id(2)]);
  assert.deepEqual(order(), [id(1), id(2), id(3)]);
  assert.equal(playerHeroes(state.players[0])[1].experience, 9000);
});
test('illusions remain in raw collections; every unit selector excludes them by default and supports opt-in', () => {
  for (const [type, flags, collection, select] of [
    ['hfoo', 2, 'units', playerUnits], ['Hmkg', 2, 'heroes', playerHeroes], ['hbar', 8, 'buildings', playerBuildings]
  ]) {
    const state = deepFreeze(apply(baseline(), [hp(1, type, flags), hp(2, type, flags, { isIllusion: true }), hp(3, type, flags)]));
    const player = state.players[0];
    assert.deepEqual(Object.keys(player[collection]), [id(1), id(2), id(3)]);
    const ordinary = select(player);
    assert.deepEqual(ordinary.map(unit => unit.id), [id(1), id(3)]);
    assert.equal(select(player, { includeIllusions: false }), ordinary);
    const all = select(player, { includeIllusions: true });
    assert.deepEqual(all.map(unit => unit.id), [id(1), id(2), id(3)]);
    assert.equal(all[1], player[collection][id(2)]);
    assert.equal(select(player, { includeIllusions: true }), all);
    assert.ok(Object.isFrozen(all));
  }
});
test('required illusion classification survives either packet order and flag-only updates without stale tombstones', () => {
  for (const observations of [
    [hp(1, 'Hmkg', 2, { isIllusion: true }), hero(1, 'Hmkg', { isIllusion: true })],
    [hero(1, 'Hmkg', { isIllusion: true }), hp(1, 'Hmkg', 2, { isIllusion: true })],
    [queue(1, [], { isIllusion: true }), hp(1, 'hbar', 8, { isIllusion: true })],
    [hp(1, 'hbar', 8, { isIllusion: true }), queue(1, [], { isIllusion: true })]
  ]) {
    const collection = observations[0].typeId === 'Hmkg' ? 'heroes' : 'buildings';
    const state = apply(baseline(), observations);
    assert.equal(state.players[0][collection][id(1)].isIllusion, true);
  }
  let state = apply(baseline(), [hp(1)]);
  const updated = apply(state, [hp(1, 'hfoo', 2, { isIllusion: true })]);
  assert.notEqual(updated, state);
  assert.equal(updated.players[0].units[id(1)].isIllusion, true);
  state = apply(updated, [hp(1, 'hfoo', 2, { removed: true })]);
  assert.deepEqual(state.players[0].units, {});
  state = apply(state, [hp(2)]);
  assert.equal(state.players[0].units[id(2)].isIllusion, false);
});
test('missing and nonboolean illusion flags cannot introduce or replace an observation', () => {
  const state = apply(baseline(), [hp(1, 'Hmkg', 2, { isIllusion: true }), hero(1, 'Hmkg', { isIllusion: true })]);
  for (const invalid of [undefined, null, 0, 1, 'false', 'true']) {
    for (const update of [hp(2), hp(1, 'Hmkg'), hero(1, 'Hmkg'), queue(3)]) {
      assert.equal(apply(state, [{ ...update, isIllusion: invalid }]), state);
    }
    const invalidSnapshot = structuredClone(state);
    invalidSnapshot.players[0].heroes[id(1)].isIllusion = invalid;
    assert.throws(() => validateState(invalidSnapshot), /isIllusion/);
  }
});
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
  const construction = hp(1, 'hbar', 8, { position: { x: -300, y: 120 }, construction: { progress: 0.4, remainingSeconds: null, totalSeconds: null } });
  const heroPosition = hp(2, 'Hamg', 2, { position: { x: 12.5, y: -45 } });
  const production = queue(1, [], { queue: [{ position: 0, typeId: 'hfoo', progress: 0.25, remainingSeconds: null, totalSeconds: null }, { position: 1, typeId: 'hfoo', progress: 0, remainingSeconds: null, totalSeconds: null }] });
  let state = apply(baseline(), [construction, heroPosition, production]);
  assert.equal(state.players[0].buildings[id(1)].construction.progress, 0.4);
  assert.equal(state.players[0].buildings[id(1)].production.queue[0].progress, 0.25);
  assert.equal(apply(state, [construction, heroPosition, production]), state);
  const previous = deepFreeze(state);
  state = apply(state, [{ ...construction, construction: { progress: null, remainingSeconds: null, totalSeconds: null } }, { ...heroPosition, position: { x: 90, y: -45 } }]);
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
    hp(3, 'Hamg', 2, { construction: { progress: 0.1, remainingSeconds: null, totalSeconds: null } }),
    hp(3, 'hbar', 8, { construction: { progress: 1.1, remainingSeconds: null, totalSeconds: null } }),
    hp(3, 'hbar', 8, { position: { x: Infinity, y: 0 } })]) assert.equal(apply(state, [invalid]), state);
});

test('production preserves observed seconds without inventing timers for waiting snapshots and rejects missing timing fields', () => {
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
  for (const remainingSeconds of [0, null]) {
    const next = apply(state, [{ ...update, queue: [{ position: 0, typeId: 'hfoo', progress: 0.25, remainingSeconds, totalSeconds: remainingSeconds === null ? null : 20 }] }]);
    assert.equal(next.players[0].buildings[id(1)].production.queue[0].remainingSeconds, remainingSeconds);
  }
  for (const remainingSeconds of [undefined, -1, Infinity, NaN, '15']) {
    const bad = { ...update, queue: [{ position: 0, typeId: 'hfoo', progress: 0.25, remainingSeconds }] };
    assert.equal(apply(state, [bad]).players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
    const snapshot = structuredClone(state); snapshot.players[0].buildings[id(1)].production.queue = bad.queue;
    assert.throws(() => validateState(snapshot), /invalid|finite|JSON/i);
  }
  for (const totalSeconds of [0, -1, 10, Infinity, NaN, '20']) {
    const bad = { ...update, queue: [{ ...update.queue[0], totalSeconds }] };
    assert.equal(apply(state, [bad]).players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
    const snapshot = structuredClone(state); snapshot.players[0].buildings[id(1)].production.queue = bad.queue;
    assert.throws(() => validateState(snapshot), /invalid|finite|JSON/i);
  }
  const badWaiting = { ...update, queue: update.queue.map(slot => ({ ...slot, remainingSeconds: 5 })) };
  assert.equal(apply(state, [badWaiting]).players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
});


test('construction uses the same required timing fields through snapshots and local updates', () => {
  const update = hp(1, 'hbar', 8, { construction: { progress: 0.25, remainingSeconds: 15, totalSeconds: 20 } });
  let state = apply(baseline(), [update]);
  assert.deepEqual(state.players[0].buildings[id(1)].construction, update.construction);
  validateState(state);
  const same = apply(state, [update]);
  assert.equal(same.players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
  // Timers can change even when the progress fraction remains unchanged.
  const next = { ...update, construction: { progress: 0.25, remainingSeconds: 30, totalSeconds: 40 } };
  state = apply(state, [next]);
  assert.deepEqual(state.players[0].buildings[id(1)].construction, next.construction);
  for (const timing of [
    { progress: 0.25 },
    { progress: 0.25, remainingSeconds: null, totalSeconds: 20 },
    { progress: 0.25, remainingSeconds: 21, totalSeconds: 20 },
    { progress: 0.25, remainingSeconds: -1, totalSeconds: 20 },
    { progress: 0.25, remainingSeconds: 0, totalSeconds: 0 }
  ]) {
    assert.equal(apply(state, [{ ...update, construction: timing }]).players[0].buildings[id(1)], state.players[0].buildings[id(1)]);
    const snapshot = structuredClone(state);
    snapshot.players[0].buildings[id(1)].construction = timing;
    assert.throws(() => validateState(snapshot), /invalid/i);
  }
  const complete = apply(state, [{ ...update, construction: { progress: 1, remainingSeconds: 0, totalSeconds: 20 } }]);
  assert.equal(complete.players[0].buildings[id(1)].construction.remainingSeconds, 0);
  const removed = apply(complete, [{ ...update, construction: undefined }]);
  assert.equal(removed.players[0].buildings[id(1)].construction, undefined);
});


test('researching upgrades use required timing instead of start/finish dates', () => {
  const state = baseline();
  state.players[0].upgrades = { upgrades: [], active: [], researching: [{
    name: 'Rhar', level: 1, gametime: 20, progress: null, remainingSeconds: null, totalSeconds: null
  }] };
  validateState(state);
  state.players[0].upgrades.researching[0] = {
    name: 'Rhar', level: 1, gametime: 20, progress: 0.5, remainingSeconds: 30, totalSeconds: 60
  };
  validateState(state);
  delete state.players[0].upgrades.researching[0].remainingSeconds;
  assert.throws(() => validateState(state), /invalid timing/i);
});


test('building read access cannot bypass a withheld production capability', () => {
  const state = apply(baseline(['match', 'buildings']), [hp(1, 'hbar', 8, {
    construction: { progress: 0.5, totalSeconds: 20, remainingSeconds: 10 }
  }), queue(1)]);
  assert.ok(state.players[0].buildings[id(1)].hitpoints);
  assert.equal(state.players[0].buildings[id(1)].construction, undefined);
  assert.equal(state.players[0].buildings[id(1)].production, undefined);
});
test('native hero order survives partial observations and is updated independently of XP', () => {
  let state = apply(baseline(), [hero(3, 'Hamg', { heroOrder: 1 }), hero(1, 'Hmkg', { heroOrder: 2 }), hero(2, 'Hpal', { heroOrder: 3 })]);
  assert.equal(state.players[0].heroes[id(3)].heroOrder, 1);
  // General SDK selectors retain their documented deterministic ID default.
  assert.deepEqual(playerHeroes(state.players[0]).map(h => h.id), [id(1), id(2), id(3)]);
  for (const value of [undefined, 0, -1, 1.5, '4', null, 0x80000000, NaN]) {
    state = apply(state, [hero(1, 'Hmkg', { heroOrder: value }), hp(1, 'Hmkg', 2, { removed: true })]);
    assert.equal(state.players[0].heroes[id(1)].heroOrder, 2);
  }
  for (const current of [0, 450]) {
    state = apply(state, [hp(1, 'Hmkg', 2, { hitpoints: { current, max: 450 } }), hero(1, 'Hmkg', { experience: 900 })]);
    assert.equal(state.players[0].heroes[id(1)].heroOrder, 2);
  }
  state = apply(state, [hero(1, 'Hmkg', { heroOrder: 4 })]);
  assert.equal(state.players[0].heroes[id(1)].heroOrder, 4);
  const invalid = structuredClone(state); invalid.players[0].heroes[id(1)].heroOrder = 0;
  assert.throws(() => validateState(invalid), /heroOrder/);
});

test('hero order does not leak across ownership, removal or match reset', () => {
  let state = apply(baseline(), [hero(1, 'Hamg', { heroOrder: 3 })]);
  state = apply(state, [hero(1, 'Hamg', { slotId: 1 })]);
  assert.equal(state.players[0].heroes[id(1)], undefined);
  assert.equal(state.players[1].heroes[id(1)].heroOrder, undefined);
  state = apply(state, [hero(1, 'Hamg', { slotId: 1, heroOrder: 1 })]);
  assert.equal(state.players[1].heroes[id(1)].heroOrder, 1);
  state = apply(state, [hero(1, 'Hamg', { slotId: 1, removed: true })]);
  state = apply(state, [hero(1, 'Hamg', { slotId: 1 })]);
  assert.equal(state.players[1].heroes[id(1)].heroOrder, undefined);
  const fresh = apply(baseline(), [hero(1)]);
  assert.equal(fresh.players[0].heroes[id(1)].heroOrder, undefined);
});
