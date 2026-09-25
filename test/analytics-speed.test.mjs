import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchHistory } from '../src/analytics.js';
import { GameTimeInterpolator } from '../src/internal/interpolation.js';
import { validateState } from '../src/internal/protocol.js';
import { readFileSync } from 'node:fs';

const heroId = '0000000000000001';
function state(time, at = time, speed = 64, count = 0) {
  return {
    capabilities: ['match', 'players', 'resources', 'heroes', 'units', 'buildings'], gameContext: { hudScale: 1 },
    match: { id: 'speed-test', status: 'running', mode: '1v1', isReplay: true, gameTime: time, gameSpeed: speed },
    players: [{ id: '0', statistics: { gameTime: at, goldMined: count * 10, goldUpkeepLost: 0,
      items: { tpot: { collected: count, purchased: 0, used: count, sold: 0, destroyed: 0 } },
      heroes: { [heroId]: { typeId: 'Hamg', deaths: count, totalKills: 0, heroKills: 0, selfKills: 0, buildingKills: 0, timeAliveMs: 0 } }
    }, losses: { gameTime: at, units: { hfoo: count }, buildings: { hbar: count }, complete: false } }]
  };
}
function harness() {
  let now = 0;
  const history = createMatchHistory({ now: () => now });
  return { history, push(wall, frame) { now = wall; history.push(frame); } };
}

for (const speed of [1, 2, 4, 8, 16, 32, 64]) test(`${speed}x preserves measured economy and all loss counters between 500 ms samples`, () => {
  const { history, push } = harness();
  for (let sample = 0; sample <= 10; sample++) {
    const at = sample * .5 * speed;
    push(sample * 500, state(at, at, speed, sample));
    assert.equal(history.economy('0').length, sample + 1);
    if (sample < 10) for (let tick = 50; tick < 500; tick += 50) {
      push(sample * 500 + tick, state(at + tick / 1000 * speed, at, speed, sample));
      assert.equal(history.economy('0').length, sample + 1);
    }
  }
  const window = history.window('0', 5 * speed);
  assert.equal(window.covered, true);
  for (const [kind, type] of [['unit-lost', 'hfoo'], ['building-lost', 'hbar'], ['hero-lost', 'Hamg'], ['item-used', 'tpot']]) {
    assert.equal(window.counts[kind][type], 10);
  }
  assert.deepEqual(history.economy('0').map(p => p.gameTime), Array.from({ length: 11 }, (_, i) => i * .5 * speed));
});

test('transient zero rates and 64x to 1x transitions preserve the next healthy observation', () => {
  const { history, push } = harness();
  push(0, state(100, 100));
  push(200, state(112, 100, 0));
  push(500, state(128, 139.775, 0, 1)); // Clock temporarily behind a valid new sample in the live capture.
  assert.equal(history.economy('0').length, 2);
  push(600, state(145, 139.775, 1, 1));
  push(1000, state(145.4, 145.4, 1, 2));
  assert.equal(history.economy('0').length, 3);
  push(2000, state(153, 146, 1, 3)); // Grace is bounded; ordinary five-second protection resumes.
  assert.deepEqual(history.economy('0'), []);
});

test('frozen timestamps expire in real time even with high speed and changing counters', () => {
  const { history, push } = harness();
  push(0, state(100));
  push(5000, state(100, 100, 64, 1));
  assert.equal(history.economy('0').length, 1);
  push(5001, state(100, 100, 64, 2));
  assert.deepEqual(history.economy('0'), []);
  assert.equal(history.window('0', 30).covered, false);
  push(5500, state(132, 132, 64, 4));
  assert.equal(history.economy('0').length, 1);
  assert.equal(history.window('0', 30).counts['unit-lost'].hfoo, undefined, 'recovery starts a baseline');
});

test('a fresh sample after a silent delivery gap cannot bridge economic or loss history', () => {
  const { history, push } = harness();
  push(0, state(100)); push(500, state(132, 132, 64, 1));
  push(6000, state(484, 484, 64, 7));
  assert.deepEqual(history.economy('0').map(p => p.gameTime), [484]);
  const window = history.window('0', 500);
  assert.equal(window.counts['hero-lost'].Hamg, 1);
  assert.equal(window.counts['unit-lost'].hfoo, 1);
  assert.equal(window.covered, false);
});

test('paused and finished playback do not age a healthy observation; resume still expires frozen data', () => {
  const { history, push } = harness();
  push(0, state(100));
  const paused = state(132, 132, 0, 1); paused.match.paused = true;
  push(500, paused); push(60500, paused);
  assert.equal(history.economy('0').length, 2);
  push(61000, state(132, 132, 1, 1));
  assert.equal(history.economy('0').length, 2);
  push(66001, state(132, 132, 1, 1));
  assert.deepEqual(history.economy('0'), []);
  const finished = state(133, 133, 0, 2); finished.match.status = 'finished';
  push(66500, finished); push(166500, finished);
  assert.equal(history.economy('0').length, 1);
});

test('missing fields and frozen opponents still invalidate independently at high speed', () => {
  const { history, push } = harness();
  const pair = (time, at, count) => {
    const s = state(time, at, 64, count);
    s.players.push({ ...state(time, at, 64, count).players[0], id: '1' }); return s;
  };
  push(0, pair(100, 100, 0));
  const missing = pair(132, 132, 1); delete missing.players[1].statistics.goldMined;
  push(500, missing);
  assert.equal(history.economy('0').length, 2); assert.deepEqual(history.economy('1'), []);
  push(1000, pair(164, 164, 2));
  for (let wall = 1500; wall <= 6500; wall += 500) {
    const s = pair(100 + wall * .064, 100 + wall * .064, wall / 500);
    s.players[1].statistics = state(164, 164, 64, 2).players[0].statistics;
    push(wall, s);
  }
  assert.equal(history.economy('0').length, 14);
  assert.deepEqual(history.economy('1'), []);
});

test('expired observations cannot be revived by changing speed; resets discard speed history', () => {
  const { history, push } = harness();
  push(0, state(100, 100, 1)); push(100, state(106, 100, 1));
  assert.deepEqual(history.economy('0'), []);
  push(200, state(107, 100, 64)); assert.deepEqual(history.economy('0'), []);
  const other = state(7, 0, 1); other.match.id = 'other';
  push(300, other); assert.deepEqual(history.economy('0'), []);
  push(400, state(100, 100, 64));
  history.reset(); push(500, state(107, 100, 1)); assert.deepEqual(history.economy('0'), []);
});

test('without observed replay speed the five-game-second guard remains; malformed speed cannot bypass it', () => {
  for (const speed of [undefined, -1, 65, Infinity, NaN, '64']) {
    const { history, push } = harness();
    const first = state(100), next = state(106, 100);
    first.match.gameSpeed = speed; next.match.gameSpeed = speed;
    push(0, first); push(100, next);
    assert.deepEqual(history.economy('0'), []);
  }
  const { history, push } = harness();
  const live = state(100); live.match.isReplay = false; live.match.isObserver = true;
  push(0, live); live.match.gameTime = 106; push(100, live);
  assert.deepEqual(history.economy('0'), []);
});

test('history validates its injected receipt clock', () => {
  assert.throws(() => createMatchHistory({ now: 1 }), TypeError);
  for (const value of [NaN, Infinity]) assert.throws(() => createMatchHistory({ now: () => value }).push(state(0)), RangeError);
  const { push } = harness(); push(100, state(0)); assert.throws(() => push(99, state(1)), RangeError);
});

test('SDK projects validated public speed without leaking private clock fields', () => {
  let now = 0;
  const i = new GameTimeInterpolator(() => {}, { now: () => now, schedule: () => 1, cancel() {} });
  const raw = state(100); delete raw.match.gameSpeed;
  raw.transport = { recorderUrls: [], interpolation: { clock: { sample: 1, times: [100, 100], rates: [64, 1], gameTime: 100 }, entries: [] } };
  const projected = i.update(raw);
  validateState(projected);
  assert.equal(projected.match.gameSpeed, 64);
  assert.equal(raw.match.gameSpeed, undefined); assert.equal(projected.transport, undefined);
  assert.equal(structuredClone(projected).match.gameSpeed, 64);
  now = 1001; assert.equal(i.update(raw).match.gameSpeed, undefined);
  raw.match.paused = true; assert.equal(i.update(raw).match.gameSpeed, 0);
  raw.match.paused = false; raw.match.status = 'finished'; assert.equal(i.update(raw).match.gameSpeed, 0);
  for (const invalid of [-1, 65, '64', null]) assert.throws(() => validateState(state(100, 100, invalid)));
  delete raw.transport; i.reset(); assert.equal(i.update(raw).match.gameSpeed, undefined);
  i.reset();
});

for (const [name, samples] of [['antoine-64x', 62], ['sok-lyn-64x', 81]]) test(`captured ${name} retains every measured pair through normal SDK interpolation`, () => {
  const capture = JSON.parse(readFileSync(new URL(`./fixtures/analytics-speed/${name}.json`, import.meta.url), 'utf8'));
  let now = 0, timer;
  const history = createMatchHistory({ now: () => now });
  const raw = state(0); delete raw.match.gameSpeed;
  raw.players = [{ id: '0' }, { id: '1' }];
  let initialized = false, lastLength = 0;
  function record(frame) {
    history.push(frame);
    const length = history.economy('0').length;
    if (length) initialized = true;
    if (initialized) {
      assert.ok(length >= lastLength, `history reset at ${now} ms / game ${frame.match.gameTime}`);
      assert.equal(history.economy('1').length, length);
    }
    lastLength = length;
  }
  const interpolator = new GameTimeInterpolator(record, { now: () => now,
    schedule: fn => { timer = { at: now + 50, fn }; return 1; }, cancel: () => { timer = undefined; } });
  for (const [wall, updates] of capture.events) {
    while (timer && timer.at <= wall) { now = timer.at; const fn = timer.fn; timer = undefined; fn(); }
    now = wall;
    for (const [kind, key, value] of updates) {
      if (kind === 'clock') raw.transport = { recorderUrls: [], interpolation: { clock: key, entries: [] } };
      if (kind === 'time') raw.match = { ...raw.match, gameTime: key };
      if (kind === 'statistics') raw.players = raw.players.map(p => p.id === key ? { ...p, statistics: value } : p);
    }
    record(interpolator.update(raw));
  }
  interpolator.reset();
  assert.equal(lastLength, samples);
  assert.deepEqual(history.economy('0').map(p => p.gameTime), history.economy('1').map(p => p.gameTime));
});
