import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/index.js';

const snapshot = () => ({
  capabilities: ['match', 'future-capability'],
  match: { id: 'game', status: 'running', mode: '1v1', gameTime: 30 },
  gameContext: { hudScale: 1 },
  players: [{
    id: '0', race: 'human', startPosition: { x: 0, y: 0 },
    resources: { gold: 100, lumber: 50, supply: 5, supplyCap: 10 },
    mainAccount: { name: 'Player' },
    stats: { solo: { wins: 2, losses: 1, winRate: 66 } },
    controlgroups: { 1: { frontunit: 'hpea', size: 5 } },
    heroes: [{ id: 'hero', name: 'Hamg', level: 1,
      hitpoints: { current: 400, max: 500 }, mana: { current: 100, max: 300 },
      abilities: [{ id: 'ability', name: 'AHbz', level: 1 }] }],
    upgrades: { upgrades: [{ name: 'Rhme', level: 1, gametime: 20 }], active: [], researching: [] }
  }],
  application: { clientId: 'future_test', settings: {}, data: {} },
  transport: { recorderUrls: [] }
});

async function stream(t) {
  let context;
  let sequence = 0;
  let resyncs = 0;
  const issues = [];
  const client = createClient({ clientId: 'future_test', transport: {
    name: 'future-api', open(value) { context = value; }, close() {}, resync() { resyncs++; }
  } });
  t.after(() => client.disconnect());
  client.on('issue', issue => issues.push(issue));
  await client.open();
  return { client, issues, get resyncs() { return resyncs; },
    send(type, data, version = '2.99') {
      context.onMessage(JSON.stringify({ version, sequence: ++sequence, type, data, futureEnvelopeField: true }));
    } };
}

test('new API attributes survive snapshots at every known object level without an SDK upgrade', async t => {
  const connection = await stream(t);
  const input = snapshot();
  input.match.result = { playerId: '0', outcome: 'won' };
  const objects = [input, input.match, input.match.result, input.gameContext, input.players[0],
    input.players[0].startPosition, input.players[0].resources, input.players[0].mainAccount,
    input.players[0].stats, input.players[0].stats.solo, input.players[0].controlgroups[1],
    input.players[0].heroes[0], input.players[0].heroes[0].hitpoints, input.players[0].heroes[0].mana,
    input.players[0].heroes[0].abilities[0], input.players[0].upgrades,
    input.players[0].upgrades.upgrades[0], input.application, input.application.settings,
    input.application.data, input.transport];
  for (const object of objects) object.futureAttribute = { list: [1, null, { enabled: true }] };
  connection.send('state.snapshot', input);
  const { transport, ...expected } = input;
  assert.deepEqual(connection.client.state.get(), expected);
  assert.equal(connection.client.state.get().transport, undefined);
  assert.ok(Object.isFrozen(connection.client.state.get().players[0].heroes[0].futureAttribute.list[2]));
  assert.equal(connection.client.lifecycle.get().isSynchronized, true);
  assert.deepEqual(connection.issues, []);
  assert.equal(connection.resyncs, 0);
});

test('unknown branches support add, replace, nested edits and removal alongside known patches', async t => {
  const connection = await stream(t);
  connection.send('state.snapshot', snapshot());
  const initial = connection.client.state.get();
  connection.send('state.patch', [
    { op: 'add', path: '/future', value: { entries: [{ value: 1 }] }, futureMetadata: true },
    { op: 'add', path: '/players/0/future', value: false },
    { op: 'replace', path: '/match/gameTime', value: 31 }
  ]);
  const added = connection.client.state.get();
  assert.equal(added.match.gameTime, 31);
  assert.equal(added.players[0].future, false);
  assert.equal(added.future.entries[0].value, 1);
  connection.send('state.patch', [
    { op: 'replace', path: '/future/entries/0/value', value: 2 },
    { op: 'add', path: '/future/entries/-', value: { value: 3 } },
    { op: 'remove', path: '/players/0/future' }
  ]);
  assert.deepEqual(connection.client.state.get().future.entries, [{ value: 2 }, { value: 3 }]);
  assert.equal(connection.client.state.get().players[0].future, undefined);
  connection.send('state.patch', [{ op: 'remove', path: '/future' }]);
  assert.equal(connection.client.state.get().future, undefined);
  assert.equal(initial.match.gameTime, 30);
  assert.equal(added.future.entries[0].value, 1, 'patches must not mutate previous snapshots');
  assert.equal(connection.client.lifecycle.get().isSynchronized, true);
  assert.deepEqual(connection.issues, []);
  assert.equal(connection.resyncs, 0);
});

test('unknown events between state updates do not break sequencing or synchronization', async t => {
  const connection = await stream(t);
  const notices = [];
  connection.client.onUnknown('future.notice', data => notices.push(data));
  connection.send('state.snapshot', snapshot());
  const initial = connection.client.state.get();
  connection.send('future.unhandled', { value: 1 });
  connection.send('future.notice', { value: 2 });
  assert.equal(connection.client.state.get(), initial);
  connection.send('state.patch', [{ op: 'replace', path: '/match/gameTime', value: 31 }]);
  assert.equal(connection.client.state.get().match.gameTime, 31);
  assert.deepEqual(notices, [{ value: 2 }]);
  assert.deepEqual(connection.issues, []);
  assert.equal(connection.resyncs, 0);
});

for (const [name, change] of [
  ['changed known field type', state => { state.match.gameTime = '30'; }],
  ['removed required field', state => { delete state.gameContext; }],
  ['new match status', state => { state.match.status = 'future-status'; }],
  ['new race', state => { state.players[0].race = 'future-race'; }],
  ['new result outcome', state => { state.match.result = { playerId: '0', outcome: 'draw' }; }],
  ['new application surface', state => { state.application.surface = 'future-surface'; }],
  ['reserved retired field', state => { state.overlay = { runtime: {} }; }],
  ['unsafe unknown field', state => { state.future = JSON.parse('{"__proto__":{"polluted":true}}'); }]
]) {
  test(`${name} is not an additive compatible API change`, async t => {
    const connection = await stream(t);
    connection.send('state.snapshot', snapshot());
    const previous = connection.client.state.get();
    const invalid = snapshot();
    change(invalid);
    connection.send('state.snapshot', invalid);
    assert.equal(connection.client.state.get(), previous);
    assert.equal(connection.issues.length, 1);
    assert.equal(connection.client.lifecycle.get().isSynchronized, false);
  });
}

test('a new protocol major still requires an explicit SDK migration', async t => {
  const connection = await stream(t);
  connection.send('state.snapshot', snapshot(), '3.0');
  assert.equal(connection.client.state.get(), null);
  assert.equal(connection.client.status, 'error');
  assert.equal(connection.issues[0].error.code, 'UNSUPPORTED_PROTOCOL');
});
