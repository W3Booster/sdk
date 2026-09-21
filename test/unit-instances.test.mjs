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
  assert.equal(supportsProtocolVersion('4.99'), true);
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
    typeId: 'Rhar', level: 1, gametime: 20, progress: null, remainingSeconds: null, totalSeconds: null
  }] };
  validateState(state);
  state.players[0].upgrades.researching[0] = {
    typeId: 'Rhar', level: 1, gametime: 20, progress: 0.5, remainingSeconds: 30, totalSeconds: 60
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


test('building upgrades stay separate from queues and disappear on cancel, completion and lost access', () => {
  const upgrade = { typeId: 'hkee', progress: 0.5, remainingSeconds: 70, totalSeconds: 140 };
  const observation = hp(301, 'htow', 8, { upgrade });
  let state = apply(baseline(), [observation, queue(301, [], { typeId: 'htow' })]);
  const building = () => state.players[0].buildings[id(301)];
  assert.deepEqual(building().upgrade, upgrade);
  assert.deepEqual(building().production.queue, []);
  assert.equal(apply(state, [observation]), state);
  state = apply(state, [hp(301, 'htow', 8)]);
  assert.equal(building().upgrade, undefined);
  state = apply(state, [observation]);
  state = apply(state, [hp(301, 'hkee', 8)]);
  assert.equal(building().upgrade, undefined);
  assert.equal(building().typeId, 'hkee');
  const limited = apply(baseline(['match', 'buildings']), [observation]);
  assert.equal(limited.players[0].buildings[id(301)].upgrade, undefined);
  for (const bad of [{ ...upgrade, typeId: 'bad' }, { ...upgrade, remainingSeconds: 141 }, { ...upgrade, progress: NaN }]) {
    const invalid = baseline();
    assert.equal(apply(invalid, [hp(301, 'htow', 8, { upgrade: bad })]), invalid);
    const snapshot = baseline(); snapshot.players[0].buildings[id(301)] = { id: id(301), typeId: 'htow', isIllusion: false, upgrade: bad };
    assert.throws(() => validateState(snapshot, undefined, false));
  }
});

test('direct inventory cooldowns retain duplicate slots and clear with expiry or changed inventory', () => {
  const cooldown = { progress: 0.5, remainingSeconds: 15, totalSeconds: 30 };
  const observation = hero(302, 'Hamg', { inventory: ['spre', 'spre', '', '', '', ''], inventoryCooldowns: [null, cooldown, null, null, null, null] });
  let state = apply(baseline(), [observation]);
  assert.deepEqual(state.players[0].heroes[id(302)].inventoryCooldowns, observation.inventoryCooldowns);
  assert.equal(apply(state, [observation]), state); // No wall-clock advancement during a pause.
  const swapped = { ...observation, inventoryCooldowns: [cooldown, null, null, null, null, null] };
  state = apply(state, [swapped]);
  assert.deepEqual(state.players[0].heroes[id(302)].inventoryCooldowns, swapped.inventoryCooldowns);
  state = apply(state, [{ ...observation, inventoryCooldowns: Array(6).fill(null) }]);
  assert.deepEqual(state.players[0].heroes[id(302)].inventoryCooldowns, Array(6).fill(null));
  state = apply(state, [observation]);
  state = apply(state, [{ ...observation, inventory: ['ratf', '', '', '', '', ''], inventoryCooldowns: undefined }]);
  assert.equal(state.players[0].heroes[id(302)].inventoryCooldowns, undefined);
  for (const invalid of [[cooldown], [null, null, cooldown, null, null, null], [null, { ...cooldown, remainingSeconds: 31 }, null, null, null, null]]) {
    const original = baseline();
    assert.equal(apply(original, [{ ...observation, inventoryCooldowns: invalid }]), original);
    const snapshot = baseline(); snapshot.players[0].heroes[id(302)] = { id: id(302), typeId: 'Hamg', isIllusion: false, inventory: observation.inventory, inventoryCooldowns: invalid };
    assert.throws(() => validateState(snapshot, undefined, false));
  }
});

test('mana preserves observed net regeneration including zero and negative rates, and clears unavailable rates', () => {
  let state = apply(baseline(), [hero(1)]);
  for (const regenerationPerSecond of [2.5, 0, -3]) {
    const mana = { current: 50, max: 300, regenerationPerSecond };
    state = apply(state, [hp(1, 'Hamg', 2, { mana })]);
    assert.deepEqual(state.players[0].heroes[id(1)].mana, mana);
  }
  const previous = state;
  state = apply(state, [hp(1, 'Hamg', 2, { mana: { current: 50, max: 300, regenerationPerSecond: Infinity } })]);
  assert.equal(state, previous);
  state = apply(state, [hp(1, 'Hamg', 2, { mana: { current: 50, max: 300 } })]);
  assert.deepEqual(state.players[0].heroes[id(1)].mana, { current: 50, max: 300 });
});

test('native APM preserves zero, validates observations and enforces resource capability and self-play ownership', () => {
  const update = (slotId, apm) => ({ class: 'W3PlayerMetrics', matchId: 42, slotId, apm });
  let state = apply(baseline(['resources']), [update(0, 0), update(1, 180)]);
  assert.equal(state.players[0].apm, 0); assert.equal(state.players[1].apm, 180);
  for (const apm of [-1, 1.5, Infinity, '3', undefined]) assert.equal(apply(state, [update(0, apm)]), state);
  state = apply(state, [update(0, null)]); assert.equal(state.players[0].apm, undefined);
  assert.equal(apply(baseline([]), [update(0, 50)]).players[0].apm, undefined);
  const normal = baseline(['resources']); normal.match.isReplay = false; normal.match.realBroadcasterPlayerId = '0';
  const self = apply(normal, [update(0, 90), update(1, 200)]);
  assert.equal(self.players[0].apm, 90); assert.equal(self.players[1].apm, undefined);
});

test('combat totals preserve engine lifetime values, clear on unavailable data, and obey hero scope', () => {
  const combat = { damageDealt: 400, selfDamage: 28, damageReceived: 98, healingDealt: 250 };
  let state = apply(baseline(), [hp(1, 'Hpal', 2, { combat })]);
  assert.deepEqual(state.players[0].heroes[id(1)].combat, combat);
  state = apply(state, [hero(1, 'Hpal')]);
  assert.deepEqual(state.players[0].heroes[id(1)].combat, combat);
  const unchanged = apply(state, [hp(1, 'Hpal', 2, { combat })]);
  assert.equal(unchanged.players[0].heroes[id(1)].combat, state.players[0].heroes[id(1)].combat);
  for (const invalid of [null, { ...combat, selfDamage: 99 }, { ...combat, healingDealt: NaN }, { ...combat, damageDealt: -1 }]) {
    assert.equal(apply(state, [hp(1, 'Hpal', 2, { combat: invalid })]), state);
  }
  assert.deepEqual(apply(baseline(['match','units']), [hp(1, 'Hpal', 2, { combat })]).players[0].heroes, {});
  assert.deepEqual(apply(baseline(), [hp(1, 'hfoo', 2, { combat })]).players[0].units, {});
  const own = { ...baseline(), match: { ...baseline().match, isReplay: false } };
  assert.deepEqual(apply(own, [hp(1, 'Hpal', 2, { combat, slotId: 1 })]).players[1].heroes, {});
  state = apply(state, [hp(1, 'Hpal')]);
  assert.equal(state.players[0].heroes[id(1)].combat, undefined);
  const zero = Object.fromEntries(Object.keys(combat).map(key => [key, 0]));
  state = apply(state, [hp(1, 'Hpal', 2, { combat: zero })]);
  assert.deepEqual(state.players[0].heroes[id(1)].combat, zero, 'replay rewind replaces totals rather than accumulating');
  state = apply(state, [hp(1, 'Hpal', 2, { removed: true })]);
  assert.equal(state.players[0].heroes[id(1)].combat, undefined);
  const badSnapshot = baseline(); badSnapshot.players[0].heroes[id(1)] = { id: id(1), typeId: 'Hpal', isIllusion: false, combat: { ...combat, selfDamage: 500 } };
  assert.throws(() => validateState(badSnapshot, undefined, false), /combat/);
});

test('summon-inclusive unit contributions reconcile, preserve shared credit and immutable observations', () => {
  const contribution = (damageDealt, ...types) => ({ damageDealt, units: types.map(typeId => ({ typeId, isIllusion: false })) });
  const damage = { total: 750, complete: true,
    breakdown: [contribution(600, 'Hamg', 'hwt3'), contribution(150, 'efon')] };
  const combat = { damageDealt: 600, selfDamage: 0, damageReceived: 0, healingDealt: 0, damage };
  const state = apply(baseline(), [hp(1, 'Hamg', 2, { combat })]);
  const observed = state.players[0].heroes[id(1)].combat;
  assert.deepEqual(observed.damage, damage);
  damage.breakdown[0].units[0].typeId = 'Hpal';
  damage.breakdown[1].damageDealt = 999;
  assert.equal(observed.damage.breakdown[0].units[0].typeId, 'Hamg');
  assert.equal(observed.damage.breakdown[1].damageDealt, 150);
  const partial = { ...observed.damage, complete: false };
  const updated = apply(state, [hp(1, 'Hamg', 2, { combat: { ...observed, damage: partial } })]);
  assert.equal(updated.players[0].heroes[id(1)].combat.damage.complete, false);
  for (const bad of [null, { ...partial, total: 749 }, { ...partial, complete: 'true' },
    ...[[], [contribution(-1, 'Hamg')], [contribution(Infinity, 'Hamg')], [contribution(750)],
      [contribution(750, 'invalid')], [contribution(750, 'Hamg', 'Hamg')],
      [contribution(400, 'Hamg'), contribution(350, 'Hamg')],
      [contribution(400, 'Hamg', 'hwt3'), contribution(350, 'hwt3')],
      [{ damageDealt: 750, units: [{ typeId: 'Hamg', isIllusion: 0 }] }]].map(breakdown => ({ ...partial, breakdown }))]) {
    assert.equal(apply(updated, [hp(1, 'Hamg', 2, { combat: { ...observed, damage: bad } })]), updated);
    const invalid = baseline(); invalid.players[0].heroes[id(1)] = {
      id: id(1), typeId: 'Hamg', isIllusion: false, combat: { ...observed, damage: bad } };
    assert.throws(() => validateState(invalid, undefined, false), /combat/);
  }
  const rewind = { total: 0, complete: true, breakdown: [contribution(0, 'Hamg')] };
  const reset = apply(updated, [hp(1, 'Hamg', 2, { combat: { ...observed, damageDealt: 0, damage: rewind } })]);
  assert.deepEqual(reset.players[0].heroes[id(1)].combat.damage, rewind);
  const { damage: omitted, ...legacy } = observed;
  assert.equal(apply(updated, [hp(1, 'Hamg', 2, { combat: legacy })]).players[0].heroes[id(1)].combat.damage, undefined);
});

test('inventory charges follow slots, retain one/zero, and clear unavailable observations', () => {
  const observation = hero(303, 'Hamg', { inventory: ['hslv', 'hslv', '', '', '', ''], inventoryCharges: [3, 1, null, null, null, null] });
  const initial = apply(baseline(), [observation]);
  assert.deepEqual(initial.players[0].heroes[id(303)].inventoryCharges, observation.inventoryCharges);
  const next = apply(initial, [{ ...observation, inventoryCharges: [0, 2, null, null, null, null] }]);
  assert.deepEqual(next.players[0].heroes[id(303)].inventoryCharges, [0, 2, null, null, null, null]);
  assert.equal(initial.players[0].heroes[id(303)].inventoryCharges[0], 3);
  const moved = apply(next, [{ ...observation, inventory: ['', 'hslv', '', 'hslv', '', ''], inventoryCharges: [null, 1, null, 2, null, null] }]);
  assert.deepEqual(moved.players[0].heroes[id(303)].inventoryCharges, [null, 1, null, 2, null, null]);
  const missing = apply(moved, [{ ...observation, inventoryCharges: undefined }]);
  assert.equal(missing.players[0].heroes[id(303)].inventoryCharges, undefined);
  for (const charges of [[1], [-1, 1, null, null, null, null], [1.5, 1, null, null, null, null], [NaN, 1, null, null, null, null], [3, 1, 0, null, null, null], [0x80000000, 1, null, null, null, null]]) {
    assert.equal(apply(initial, [{ ...observation, inventoryCharges: charges }]), initial);
    const snapshot = baseline();
    snapshot.players[0].heroes[id(303)] = { id: id(303), typeId: 'Hamg', isIllusion: false, inventory: observation.inventory, inventoryCharges: charges };
    assert.throws(() => validateState(snapshot, undefined, false), /charges/i);
  }
  assert.deepEqual(apply(baseline(['match']), [observation]).players[0].heroes, {});
});


test('production kind survives both snapshot and recorder validation and is withdrawn when unavailable', () => {
  for (const buildType of ['research', 'unit', 'reviving']) {
    const update = queue(1, [], { queue: [{ position: 0, typeId: 'Hamg', buildType, progress: 0.25, remainingSeconds: 15, totalSeconds: 20 }] });
    const state = apply(baseline(), [update]);
    assert.equal(state.players[0].buildings[id(1)].production.queue[0].buildType, buildType);
    validateState(state);
    const bad = structuredClone(update); bad.queue[0].buildType = 'guessed';
    assert.equal(apply(state, [bad]), state);
    const malformed = structuredClone(state); malformed.players[0].buildings[id(1)].production.queue[0].buildType = 2;
    assert.throws(() => validateState(malformed));
    const unknown = structuredClone(update); delete unknown.queue[0].buildType;
    assert.equal(apply(state, [unknown]).players[0].buildings[id(1)].production.queue[0].buildType, undefined);
  }
});
