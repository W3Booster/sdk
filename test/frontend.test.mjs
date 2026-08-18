import test from 'node:test';
import assert from 'node:assert/strict';
import { createReactStore, createReactSelectorStore } from '../src/react.js';

function immediateStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      listener(value);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener(value);
    }
  };
}

test('frontend external-store adapters suppress eager subscription calls and publish later changes', () => {
  const source = immediateStore({ status: 'idle', count: 0 });
  const store = createReactStore(source);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications += 1; });
  assert.equal(notifications, 0);
  assert.deepEqual(store.getSnapshot(), { status: 'idle', count: 0 });
  assert.deepEqual(store.getServerSnapshot(), { status: 'idle', count: 0 });
  source.set({ status: 'connected', count: 1 });
  assert.equal(notifications, 1);
  unsubscribe();
  source.set({ status: 'closed', count: 2 });
  assert.equal(notifications, 1);
});

test('selector external stores notify only when their stable selected value changes', () => {
  const source = immediateStore({ status: 'idle', count: 0 });
  const store = createReactSelectorStore(source, snapshot => snapshot.status);
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  source.set({ status: 'idle', count: 1 });
  assert.equal(notifications, 0);
  source.set({ status: 'connected', count: 2 });
  assert.equal(notifications, 1);
  assert.equal(store.getSnapshot(), 'connected');
});

test('React adapters capture stable server snapshots at creation', () => {
  const source = immediateStore({ status: 'idle', count: 0 });
  const store = createReactStore(source, { getServerSnapshot: () => ({ status: 'server', count: 0 }) });
  const selected = createReactSelectorStore(
    source,
    snapshot => ({ status: snapshot.status }),
    { getServerSnapshot: () => ({ status: 'server', count: 0 }) }
  );
  const first = store.getServerSnapshot();
  const firstSelected = selected.getServerSnapshot();
  assert.equal(store.getServerSnapshot(), first);
  assert.equal(selected.getServerSnapshot(), firstSelected);
});

test('selector external stores notify every subscriber and refresh snapshots while idle', () => {
  const source = immediateStore({ status: 'idle', count: 0 });
  const store = createReactSelectorStore(source, snapshot => snapshot.status);
  const notifications = [0, 0];
  const first = store.subscribe(() => { notifications[0] += 1; });
  const second = store.subscribe(() => { notifications[1] += 1; });
  source.set({ status: 'connected', count: 1 });
  assert.deepEqual(notifications, [1, 1]);
  first();
  second();

  source.set({ status: 'closed', count: 2 });
  assert.equal(store.getSnapshot(), 'closed');
});

test('one failing selector-store subscriber does not block the others', () => {
  const source = immediateStore({ status: 'idle' });
  const store = createReactSelectorStore(source, snapshot => snapshot.status);
  let laterNotifications = 0;
  store.subscribe(() => { throw new Error('subscriber failed'); });
  store.subscribe(() => { laterNotifications += 1; });
  assert.throws(() => source.set({ status: 'connected' }), /subscriber failed/);
  assert.equal(laterNotifications, 1);
});
