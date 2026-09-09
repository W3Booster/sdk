import assert from 'node:assert/strict';
import test from 'node:test';
import { watchOverlayComposition } from '../src/compositor.js';
import { createBrokerTransport } from '../src/internal/broker.js';
import { ConnectionError, isRetryableConnectionError, ProtocolError } from '../src/internal/errors.js';
import { fetchJsonWithTimeout } from '../src/internal/network.js';

const errors = {
  invalidJson: cause => new ProtocolError('INVALID_RESPONSE', 'Invalid JSON', cause),
  timeout: cause => new ConnectionError('Timed out', [cause])
};

for (const phase of ['request', 'body']) {
  test(`network failures during ${phase} stay retryable without retrying argument errors`, async t => {
    const failure = new TypeError('Failed to fetch');
    t.mock.method(globalThis, 'fetch', async () => {
      if (phase === 'request') throw failure;
      return { ok: true, json: async () => { throw failure; } };
    });
    await assert.rejects(fetchJsonWithTimeout('https://example.com', {}, 1000, undefined, errors), error => {
      assert.ok(error instanceof ConnectionError);
      assert.equal(error.causes[0], failure);
      assert.equal(isRetryableConnectionError(new ConnectionError('Aggregate', [error])), true);
      return true;
    });
    assert.equal(isRetryableConnectionError(new TypeError('Invalid SDK options')), false);
    assert.equal(isRetryableConnectionError(new ConnectionError('Aggregate', [new TypeError('Invalid credentials provider')])), false);
  });
}

test('malformed response JSON remains a permanent protocol error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('invalid', { status: 200 }));
  await assert.rejects(fetchJsonWithTimeout('https://example.com', {}, 1000, undefined, errors), error => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(isRetryableConnectionError(error), false);
    return true;
  });
});

for (const kind of ['composition', 'match data']) {
  test(`${kind} reconnects after repeated browser fetch failures`, async t => {
    const sockets = [];
    const received = [];
    const failures = [];
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      if (requests === 2 || requests === 3) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ protocolVersion: '3.0', websocketUrl: 'wss://example.com/stream' }));
    });
    const original = globalThis.WebSocket;
    globalThis.WebSocket = class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      listeners = new Map();
      constructor() { sockets.push(this); }
      addEventListener(type, callback) {
        this.listeners.set(type, callback);
        if (type === 'open') queueMicrotask(callback);
      }
      send() {}
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.listeners.get('close')?.();
      }
      message(data) { this.listeners.get('message')?.({ data: JSON.stringify(data) }); }
    };
    let transport;
    try {
      if (kind === 'composition') {
        transport = await watchOverlayComposition({
          backendUrl: 'https://example.com', tokenProvider: () => 'session', onError: error => failures.push(error)
        }, message => received.push(message));
      } else {
        transport = createBrokerTransport('test', 'https://example.com', () => 'session', { initialDelay: 10, maxDelay: 20 });
        await transport.open({ clientId: 'test', scopes: [], protocolVersions: ['3.0'],
          onError: error => failures.push(error), onStatus() {}, onMessage: message => received.push(JSON.parse(message)) });
      }
      sockets[0].close();
      const deadline = Date.now() + 4000;
      while (sockets.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(sockets.length, 2, 'the watcher must not permanently stop after a network TypeError');
      assert.equal(requests, 4);
      assert.equal(failures.length, 2);
      assert.ok(failures.every(isRetryableConnectionError));
      sockets[1].message({ type: 'composition.ready', surface: 'streamOverlay' });
      assert.equal(received.length, 1, 'the recovered connection delivers fresh events');
    } finally {
      transport?.close();
      if (original === undefined) delete globalThis.WebSocket; else globalThis.WebSocket = original;
    }
  });
}
