import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrokerTransport } from '../src/internal/broker.js';

test('broker coalesces repeated resync requests and cancels queued work on close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  let socket;
  class FakeWebSocket {
    static OPEN = 1;
    readyState = 1;
    listeners = new Map();
    sent = [];
    constructor() { socket = this; queueMicrotask(() => this.listeners.get('open')?.()); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.listeners.get('close')?.(); }
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    protocolVersion: '2.0', websocketUrl: 'wss://example.com/apps'
  }), { status: 200 }));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const transport = createBrokerTransport('test', 'https://example.com', () => '', null);
  try {
    await transport.open({ clientId: 'test_app', scopes: [], protocolVersions: ['2.0'], onMessage() {}, onError() {}, onStatus() {} });
    for (let i = 0; i < 100; i++) transport.resync();
    assert.equal(socket.sent.length, 1);
    t.mock.timers.tick(999);
    assert.equal(socket.sent.length, 1);
    t.mock.timers.tick(1);
    assert.equal(socket.sent.length, 2);
    transport.resync();
    transport.close();
    t.mock.timers.tick(1000);
    assert.equal(socket.sent.length, 2);
  } finally {
    transport.close();
    globalThis.WebSocket = original;
  }
});
