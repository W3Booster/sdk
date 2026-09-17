import test from 'node:test';
import assert from 'node:assert/strict';
import { GameTimeInterpolator, validInterpolation } from '../src/internal/interpolation.js';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';
import { createDemoState } from '../src/testing.js';
const id = '0000000000000001';
const anchor = (value = 100, rate = 2, at = 10, clock = 0) => ({ clock, at, value, rate, min: 0, max: 1000 });
function state(rate = 1) {
  return { match: { id: '1', status: 'running', gameTime: 10 }, players: [{ id: '0', units: {
    [id]: { hitpoints: { current: 100, max: 500 }, mana: { current: 100, max: 500 }, construction: { progress: 0, remainingSeconds: 100, totalSeconds: 100 },
      production: { queue: [{ position: 0, typeId: 'hfoo', progress: 0, remainingSeconds: 100, totalSeconds: 100 }, { position: 1, typeId: 'hfoo', progress: null, remainingSeconds: null, totalSeconds: null }] } }
  } }], transport: { interpolation: { clock: { sample: 1, times: [10, 10], rates: [rate, rate], gameTime: 10, ageMs: 0 }, entries:
    ['hitpoints', 'mana', 'construction', 'production'].map(field => ({ player: '0', collection: 'units', id, field, anchor: anchor(100, ['hitpoints', 'mana'].includes(field) ? 2 : -1, 10, field === 'mana' ? 1 : 0) })) } } };
}
const unit = s => s.players[0].units[id];
function harness() {
  let time = 0, callback, frame;
  const interpolator = new GameTimeInterpolator(s => frame = s, { now: () => time, schedule: cb => { callback = cb; return 1; }, cancel: () => callback = undefined });
  return { i: interpolator, advance(ms) { time += ms; const cb = callback; callback = undefined; cb?.(); return frame; }, pending: () => !!callback };
}
for (const speed of [1, 2, 8]) test(`${speed}x uses simulation time for both pool domains and active production`, () => {
  const h = harness(), input = state(speed), initial = structuredClone(input);
  assert.equal(h.i.update(input).transport, undefined);
  const frame = h.advance(500);
  assert.equal(unit(frame).hitpoints.current, 100 + speed);
  assert.equal(unit(frame).mana.current, 100 + speed);
  assert.equal(unit(frame).production.queue[0].remainingSeconds, 100 - speed / 2);
  assert.deepEqual(unit(frame).production.queue[1], unit(input).production.queue[1]);
  assert.deepEqual(input, initial);
});
test('rate corrections, pause, power build, stop and rewind rebase without fabricated completion', () => {
  const h = harness(), s = state(); h.i.update(s); h.advance(200);
  s.transport.interpolation.clock = { sample: 2, times: [10.2, 10.2], rates: [8, 8], gameTime: 10.2 };
  s.transport.interpolation.entries[2].anchor = anchor(90, -4, 10.2);
  h.i.update(s); assert.equal(unit(h.advance(500)).construction.remainingSeconds, 74);
  s.match.paused = true; h.i.update(s); assert.equal(unit(h.advance(500)).construction.remainingSeconds, 90);
  s.match.paused = false; s.transport.interpolation.clock = { sample: 3, times: [14.2, 14.2], rates: [0, 0], gameTime: 14.2 };
  s.transport.interpolation.entries[2].anchor = anchor(74, 0, 14.2);
  assert.equal(unit(h.i.update(s)).construction.remainingSeconds, 74);
  assert.equal(h.pending(), false);
  s.transport.interpolation.clock = { sample: 4, times: [5, 5], rates: [2, 2], gameTime: 5 };
  s.transport.interpolation.entries[2].anchor = anchor(0.1, -1, 5);
  h.i.update(s); const frame = h.advance(500);
  assert.equal(unit(frame).construction.progress, 1);
  assert.equal(frame.match.gameTime, 6);
  assert.ok(unit(frame).construction); assert.equal(unit(frame).production.queue.length, 2);
});
test('missing heartbeat caps extrapolation and unrelated packets cannot refresh its deadline', () => {
  const h = harness(), s = state(); h.i.update(s);
  assert.equal(unit(h.advance(900)).hitpoints.current, 101.8);
  h.i.update(s); const last = h.advance(5000);
  assert.equal(unit(last).hitpoints.current, 102); assert.equal(h.pending(), false);
  assert.equal(unit(h.i.update(s)).hitpoints.current, 102);
  h.i.reset(); assert.equal(h.pending(), false);
  s.transport.interpolation.clock.ageMs = 2000;
  assert.equal(unit(h.i.update(s)).hitpoints.current, 102); assert.equal(h.pending(), false);
  s.transport.interpolation.clock.sample = 2; s.transport.interpolation.clock.ageMs = 0;
  s.transport.interpolation.entries[0].anchor = anchor(50, 3);
  assert.equal(unit(h.i.update(s)).hitpoints.current, 50); assert.equal(unit(h.advance(500)).hitpoints.current, 51.5);
});
test('scope loss, destruction, unavailable timers and match end remain authoritative', () => {
  const h = harness(), s = state();
  // A unit scope does not imply match:read. Private clocks still drive scoped pools.
  s.match = { id: '', status: 'none', gameTime: 0 }; h.i.update(s);
  assert.equal(unit(h.advance(500)).hitpoints.current, 101);
  delete unit(s).hitpoints; unit(s).construction.remainingSeconds = null;
  const next = h.i.update(s); assert.equal(unit(next).hitpoints, undefined); assert.equal(unit(next).construction.remainingSeconds, null);
  delete s.players[0].units[id]; assert.equal(h.i.update(s).players[0].units[id], undefined);
  s.match.status = 'finished'; h.i.update(s); h.advance(100); assert.equal(h.pending(), false);
});
test('inline local anchors are hidden; server-only anchors survive when no local clock exists', () => {
  const h = harness(), s = state(); unit(s).hitpoints.timing = anchor(20, 10);
  h.i.update(s); const frame = h.advance(500);
  assert.deepEqual(unit(frame).hitpoints, { current: 25, max: 500 });
  assert.equal(frame.transport, undefined);
  assert.ok(unit(s).hitpoints.timing);
});
test('wire metadata rejects invalid clocks, anchors and identities', () => {
  const good = state().transport.interpolation; good.entries[0].anchor.max = 3.4028234663852886e38; assert.equal(validInterpolation(good), true);
  for (const mutate of [v => v.clock.times[0] = NaN, v => v.clock.rates[0] = -1, v => v.entries[0].anchor.clock = 2,
    v => v.entries[0].anchor.max = -1, v => v.entries[0].id = '__proto__', v => v.entries[0].collection = 'inventory']) {
    const bad = structuredClone(good); mutate(bad); assert.equal(validInterpolation(bad), false);
  }
});
test('local clock metadata uses the matching game and retains the receipt age', () => {
  const s = createDemoState({ clientId: 'interpolation_test' });
  const update = { class: 'W3Clock', matchId: s.match.id, sample: 1, times: [10, 10], rates: [2, 2], gameTime: 10, __w3boosterReceivedAt: Date.now() - 300 };
  const next = applyLocalRecorderUpdates(s, [update]);
  assert.equal(next.transport.interpolation.source, 'local'); assert.ok(next.transport.interpolation.clock.ageMs >= 300);
  assert.equal(applyLocalRecorderUpdates(s, [{ ...update, matchId: 'other' }]).transport?.interpolation, undefined);
});

test('real client keeps patch baselines authoritative and freezes on gaps and disconnects', async () => {
  const { createClient, PROTOCOL_VERSION } = await import('../src/index.js');
  let context, resync = 0, publications = 0;
  const client = createClient({ clientId: 'interpolation_test', localRecorder: false,
    transport: { name: 'test', open(v) { context = v; }, close() {}, resync() { resync++; } } });
  await client.open();
  const s = createDemoState({ clientId: 'interpolation_test' });
  s.match.status = 'running'; s.match.gameTime = 10;
  const heroId = Object.keys(s.players[0].heroes)[0];
  s.players[0].heroes[heroId].hitpoints = { current: 100, max: 500 };
  s.transport = { recorderUrls: [], interpolation: { clock: { sample: 1, times: [10,10], rates: [1,1], gameTime: 10, ageMs: 0 }, entries: [
    { player: s.players[0].id, collection: 'heroes', id: heroId, field: 'hitpoints', anchor: anchor(100, 100) }
  ] } };
  client.state.subscribe(() => publications++);
  const send = (sequence, type, data) => context.onMessage({ version: PROTOCOL_VERSION, sequence, type, data });
  send(1, 'state.snapshot', s);
  assert.equal(client.state.get().transport, undefined);
  await new Promise(r => setTimeout(r, 120));
  assert.ok(client.state.get().players[0].heroes[heroId].hitpoints.current > 105);
  send(2, 'state.patch', [{ op: 'replace', path: '/transport/interpolation/entries/0/anchor', value: anchor(25, 0) }]);
  assert.equal(client.state.get().players[0].heroes[heroId].hitpoints.current, 25);
  send(4, 'state.patch', []); assert.equal(resync, 1);
  const count = publications; await new Promise(r => setTimeout(r, 120)); assert.equal(publications, count);
  s.transport.interpolation.clock.sample = 2; s.transport.interpolation.entries[0].anchor = anchor(50, 100);
  send(5, 'state.snapshot', s);
  assert.ok(Math.abs(client.state.get().players[0].heroes[heroId].hitpoints.current - 50) < 0.1);
  await new Promise(r => setTimeout(r, 120)); assert.ok(client.state.get().players[0].heroes[heroId].hitpoints.current > 55);
  await client.disconnect(); const final = publications;
  await new Promise(r => setTimeout(r, 120)); assert.equal(publications, final);
});
