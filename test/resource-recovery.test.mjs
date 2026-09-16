import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalRecorderUpdates, LocalRecorderTransport } from '../src/internal/recorder.js';
const state = (id = 'match') => ({ capabilities: ['resources'], gameContext: { hudScale: 1 },
  match: { id, status: 'running', isObserver: true }, players: [{ id: '0' }, { id: '1' }] });
const update = (type, value, slotId = 0, matchId = 'match') => ({ class: 'W3Resource', matchId, slotId, type, value });
const economy = [update(1, 0), update(2, 500), update(5, 12), update(4, 20)];

test('worker-only and partial economy batches remain unknown; measured zero is preserved', () => {
  const baseline = state();
  for (const updates of [[update(99, 12)], economy.slice(0, 3), [update(99, 12), update(99, 11, 1)]]) {
    assert.equal(applyLocalRecorderUpdates(baseline, updates), baseline);
  }
  const full = applyLocalRecorderUpdates(baseline, economy);
  assert.deepEqual(full.players[0].resources, { gold: 0, lumber: 50, supply: 12, supplyCap: 20 });
  assert.equal(full.players[1].resources, undefined);
  assert.equal(baseline.players[0].resources, undefined);
  assert.equal(applyLocalRecorderUpdates(full, economy), full);
  assert.equal(applyLocalRecorderUpdates(full, [update(99, 0)]).players[0].resources.workerSupply, 0);
});

test('invalid observations are ignored and explicit unavailable observations remove economy', () => {
  const full = applyLocalRecorderUpdates(state(), [...economy, update(99, 12)]);
  for (const value of [undefined, '', '100', NaN, Infinity, -1, false]) {
    assert.equal(applyLocalRecorderUpdates(full, [update(1, value)]), full);
  }
  const missing = applyLocalRecorderUpdates(full, [update(2, null)]);
  assert.equal(missing.players[0].resources, undefined);
  assert.equal(full.players[0].resources.lumber, 50);
  const noWorkers = applyLocalRecorderUpdates(full, [update(99, null)]);
  assert.deepEqual(noWorkers.players[0].resources, { gold: 0, lumber: 50, supply: 12, supplyCap: 20 });
});

test('transport accumulates delayed fields across frames and reconnects, and clears on a new match', async () => {
  const original = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class {
    handlers = new Map();
    constructor() { sockets.push(this); }
    addEventListener(type, fn) { this.handlers.set(type, fn); }
    close() {}
    emit(type, data) { this.handlers.get(type)?.(data); }
  };
  const transport = new LocalRecorderTransport({ enabled: true, onUpdates() { return true; }, onStatus() {}, onError(error) { throw error; } });
  const baseline = { ...state(), transport: { recorderUrls: ['ws://127.0.0.1:42001'] } };
  try {
    transport.configure(baseline); sockets[0].emit('open');
    const send = async (socket, value) => {
      socket.emit('message', { data: JSON.stringify([value]) });
      await new Promise(resolve => setTimeout(resolve, 25));
    };
    await send(sockets[0], update(99, 12));
    assert.equal(transport.applyTo(baseline).players[0].resources, undefined);
    for (const packet of economy.slice(0, 3)) await send(sockets[0], packet);
    assert.equal(transport.applyTo(baseline).players[0].resources, undefined);
    // Reconnect without replacing this match's retained observations.
    transport.stopSocket(); transport.connect(); sockets[1].emit('open');
    await send(sockets[1], economy[3]);
    assert.deepEqual(transport.applyTo(baseline).players[0].resources,
      { gold: 0, lumber: 50, supply: 12, supplyCap: 20, workerSupply: 12 });
    await send(sockets[1], update(2, null));
    assert.equal(transport.applyTo(baseline).players[0].resources, undefined);
    await send(sockets[1], update(2, 0));
    assert.equal(transport.applyTo(baseline).players[0].resources.lumber, 0);
    const second = { ...baseline, match: { ...baseline.match, id: 'second' } };
    transport.configure(second); sockets[2].emit('open');
    await send(sockets[2], update(4, 30)); // previous match packet
    await send(sockets[2], update(99, 11, 0, 'second'));
    assert.equal(transport.applyTo(second).players[0].resources, undefined);
  } finally {
    transport.close();
    if (original === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original;
  }
});
