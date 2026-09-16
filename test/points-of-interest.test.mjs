import test from 'node:test';
import assert from 'node:assert/strict';
import { validPoiCollection } from '../src/internal/poi-state.js';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';
import { validateState } from '../src/internal/protocol.js';
import { pointsOfInterest } from '../src/selectors.js';
import { deepFreeze } from '../src/internal/values.js';
const state = () => ({ capabilities: ['match', 'pois'], match: { id: 'test-match', status: 'running', gameTime: 300, mode: '1v1', isReplay: true }, players: [], gameContext: { hudScale: 1 } });
const timer = { progress: .5, remainingSeconds: 30, totalSeconds: 60 };
export const poi = (kind = 'goblin-merchant') => ({ id: '0000000000000001', kind, typeId: 'ngme', position: { x: -128, y: 64 }, observedAtGameTime: 300 });
export const collection = () => { const p = poi(); p.offers = [{ id: 'item:boot', kind: 'item', typeId: 'boot', cost: { gold: 250, lumber: 0 }, stock: { current: 1, max: 2 }, restock: timer }]; return { [p.id]: p }; };
const update = pois => ({ class: 'W3PointsOfInterest', mode: 'live', matchId: 'test-match', pois });

test('all P1/P2 types are valid, optional live fields are not invented', () => {
  for (const kind of ['goblin-merchant', 'marketplace', 'mercenary-camp', 'goblin-laboratory', 'tavern', 'fountain', 'gold-mine', 'way-gate', 'dragon-roost', 'goblin-shipyard', 'creep-camp']) {
    const p = poi(kind); const next = applyLocalRecorderUpdates(state(), [update({ [p.id]: p })]);
    assert.deepEqual(next.pois[p.id], p); validateState(next);
    assert.equal(next.pois[p.id].offers, undefined);
  }
});
test('assortments replace atomically; cooldown, initial availability and stock are independent', () => {
  const s = deepFreeze(state()); const pois = collection();
  pois[poi().id].offers[0].initialAvailability = { progress: 1, remainingSeconds: 0, totalSeconds: 120 };
  pois[poi().id].offers[0].cooldown = timer;
  const a = deepFreeze(applyLocalRecorderUpdates(s, [update(pois)]));
  assert.equal(a.pois[poi().id].offers[0].stock.current, 1);
  assert.equal(applyLocalRecorderUpdates(a, [update(pois)]), a);
  const rewind = collection(); rewind[poi().id].observedAtGameTime = 100; delete rewind[poi().id].offers;
  const b = applyLocalRecorderUpdates(a, [update(rewind)]);
  assert.equal(b.pois[poi().id].offers, undefined); assert.equal(b.pois[poi().id].observedAtGameTime, 100);
  assert.deepEqual(applyLocalRecorderUpdates(b, [update({})]).pois, {});
  assert.equal(applyLocalRecorderUpdates(b, [update(null)]).pois, undefined);
});
test('invalid observations cannot replace good data', () => {
  const s = applyLocalRecorderUpdates(state(), [update(collection())]);
  const invalid = [null, [], { bad: poi() }, { [poi().id]: { ...poi(), position: { x: Infinity, y: 0 } } }];
  for (const stock of [{ current: 3, max: 2 }, { current: -1, max: 2 }, { current: .5, max: 2 }]) {
    const c = collection(); c[poi().id].offers[0].stock = stock; invalid.push(c);
  }
  for (const remainingSeconds of [-1, 61, NaN]) {
    const c = collection(); c[poi().id].offers[0].restock = { ...timer, remainingSeconds }; invalid.push(c);
  }
  const duplicate = collection(); duplicate[poi().id].offers.push(duplicate[poi().id].offers[0]); invalid.push(duplicate);
  const privateFields = collection(); privateFields[poi().id].address = 1234; invalid.push(privateFields);
  for (const c of invalid) {
    assert.equal(validPoiCollection(c), false);
    if (c !== null) assert.equal(applyLocalRecorderUpdates(s, [update(c)]), s);
  }
});
test('requires explicit scope, match identity and observer/replay context', () => {
  const u = update(collection());
  for (const s of [{ ...state(), capabilities: ['match'] }, { ...state(), match: { ...state().match, isReplay: false } }]) {
    assert.equal(applyLocalRecorderUpdates(s, [u]), s);
    assert.throws(() => validateState({ ...s, pois: collection() }));
  }
  for (const matchId of [undefined, 'another-match', null]) { const s = state(); assert.equal(applyLocalRecorderUpdates(s, [{ ...u, matchId }]), s); }
  const numericMatch = { ...state(), match: { ...state().match, id: '1234' } };
  assert.deepEqual(applyLocalRecorderUpdates(numericMatch, [{ ...u, matchId: 1234 }]).pois, u.pois);
});
test('kind-specific metadata, dead camps, mines and gates', () => {
  for (const p of [
    { ...poi('fountain'), fountain: { restores: ['health', 'mana'], radius: 500, healthFractionPerSecond: .01, active: true } },
    { ...poi('gold-mine'), mine: { remainingGold: 0, ownerPlayerId: null } },
    { ...poi('way-gate'), wayGate: { enabled: false, destination: { x: 400, y: -100 } } },
    { ...poi('creep-camp'), camp: { state: 'cleared', members: [{ id: '0000000000000002', typeId: 'nogr', alive: false }], dropTable: [{ itemClass: 'permanent', level: 3, probability: .5 }] } }
  ]) assert.equal(validPoiCollection({ [p.id]: p }), true);
  const p = poi(); p.mine = { remainingGold: 1 }; assert.equal(validPoiCollection({ [p.id]: p }), false);
});
test('selectors retain identities, sort and filter without changing snapshots', () => {
  const a = poi(); const b = { ...poi('marketplace'), id: '0000000000000002' };
  const s = deepFreeze({ ...state(), pois: { [b.id]: b, [a.id]: a } });
  const selected = pointsOfInterest(s); assert.deepEqual(selected, [a, b]);
  assert.equal(pointsOfInterest({ ...s }), selected); assert.ok(Object.isFrozen(selected));
  assert.deepEqual(pointsOfInterest(s, { kind: 'marketplace' }), [b]);
});

test('self-play freezes the initial snapshot, including removals, timers and later reattachments', () => {
  const self = { ...state(), match: { ...state().match, isReplay: false } };
  const p = { ...poi(), observedAtGameTime: 0 };
  const initial = { class: 'W3PointsOfInterest', matchId: self.match.id, mode: 'initial', gameTime: 0, pois: { [p.id]: p } };
  const frozen = deepFreeze(applyLocalRecorderUpdates(self, [initial]));
  assert.equal(frozen.poiMode, 'initial'); validateState(frozen);
  for (const u of [update(collection()), update(null), update({}), { ...initial, pois: {} }, { ...initial, gameTime: 20 }]) {
    assert.equal(applyLocalRecorderUpdates(frozen, [u]), frozen);
  }
  assert.equal(applyLocalRecorderUpdates(self, [{ ...initial, gameTime: 20 }]), self);
  assert.equal(applyLocalRecorderUpdates(self, [{ ...initial, pois: collection() }]), self);
  const withInventory = { ...initial, pois: { [p.id]: { ...p, offers: collection()[p.id].offers } } };
  const inventorySnapshot = applyLocalRecorderUpdates(self, [withInventory]);
  validateState(inventorySnapshot); assert.equal(inventorySnapshot.pois[p.id].offers[0].stock.current, 1);
  assert.equal(applyLocalRecorderUpdates(inventorySnapshot, [update(collection())]), inventorySnapshot);
  assert.equal(applyLocalRecorderUpdates(self, [{ ...initial, matchId: 'other' }]), self);
});
