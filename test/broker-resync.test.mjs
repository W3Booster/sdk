import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrokerTransport } from '../src/internal/broker.js';

test('broker coalesces repeated resync requests and cancels queued work on close', async t => {
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
    protocolVersion: '3.0', websocketUrl: 'wss://example.com/apps'
  }), { status: 200 }));
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  const transport = createBrokerTransport('test', 'https://example.com', () => '', null);
  try {
    await transport.open({ clientId: 'test_app', scopes: [], protocolVersions: ['3.0'], onMessage() {}, onError() {}, onStatus() {} });
    // Mock only the stable timer functions: node:test's MockTimers API differs
    // between our supported Node 18 and Node 22 CI runtimes.
    let now = 10000;
    let nextTimerId = 1;
    const timers = new Map();
    t.mock.method(Date, 'now', () => now);
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, due: now + delay });
      return id;
    });
    t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
    const tick = elapsed => {
      const target = now + elapsed;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > target) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    };
    for (let i = 0; i < 100; i++) transport.resync();
    assert.equal(socket.sent.length, 1);
    assert.equal(timers.size, 1);
    tick(999);
    assert.equal(socket.sent.length, 1);
    tick(1);
    assert.equal(socket.sent.length, 2);
    transport.resync();
    transport.close();
    assert.equal(timers.size, 0);
    tick(1000);
    assert.equal(socket.sent.length, 2);
  } finally {
    transport.close();
    globalThis.WebSocket = original;
  }
});
