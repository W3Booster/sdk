import test from 'node:test';
import assert from 'node:assert/strict';
import { createReactStore, createReactSelectorStore } from '../src/react.js';
import { createMemoizedSelector, createSelectorStore, createSubscribable } from '../src/store.js';

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

function changeOnlyStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
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

test('frontend adapters do not suppress the first update from change-only sources', () => {
  const source = changeOnlyStore({ status: 'idle', count: 0 });
  const selectorStore = createSelectorStore(source, snapshot => snapshot.status);
  const values = [];
  selectorStore.subscribe(value => values.push(value));

  const reactStore = createReactStore(source);
  let reactNotifications = 0;
  reactStore.subscribe(() => { reactNotifications += 1; });

  source.set({ status: 'connected', count: 1 });
  assert.deepEqual(values, ['idle', 'connected']);
  assert.equal(reactNotifications, 1);
  assert.deepEqual(reactStore.getSnapshot(), { status: 'connected', count: 1 });
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

test('React selector stores cache allocating client snapshots until the source identity changes', () => {
  const source = immediateStore({ status: 'idle', count: 0 });
  const store = createReactSelectorStore(source, snapshot => ({ status: snapshot.status }));
  const first = store.getSnapshot();
  assert.equal(store.getSnapshot(), first);
  source.set({ status: 'idle', count: 1 });
  assert.notEqual(store.getSnapshot(), first);
  assert.equal(store.getSnapshot(), store.getSnapshot());
});

test('framework-neutral selector stores publish immediately and preserve selected identity', () => {
  const source = immediateStore({ status: 'idle', count: 0 });
  const store = createSelectorStore(source, snapshot => ({ status: snapshot.status }), {
    equals: (left, right) => left.status === right.status
  });
  const values = [];
  const lifetime = new AbortController();
  const unsubscribe = store.subscribe(value => values.push(value), { signal: lifetime.signal });
  const initial = store.get();
  source.set({ status: 'idle', count: 1 });
  assert.equal(store.get(), initial);
  source.set({ status: 'connected', count: 2 });
  assert.deepEqual(values.map(value => value.status), ['idle', 'connected']);
  lifetime.abort();
  source.set({ status: 'closed', count: 3 });
  assert.equal(values.length, 2);
  unsubscribe();
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

test('selector stores report synchronous and asynchronous subscriber failures without blocking others', async () => {
  const source = immediateStore({ status: 'idle' });
  const errors = [];
  const store = createSelectorStore(source, snapshot => snapshot.status, {
    onError: error => errors.push(error)
  });
  let laterNotifications = 0;
  let eager = true;
  assert.doesNotThrow(() => store.subscribe(() => {
    if (eager) {
      eager = false;
      throw new Error('initial subscriber failed');
    }
  }));
  store.subscribe(status => { if (status === 'connected') throw new Error('subscriber failed'); });
  store.subscribe(async status => { if (status === 'connected') throw new Error('async subscriber failed'); });
  store.subscribe(() => { laterNotifications += 1; });
  laterNotifications = 0;
  source.set({ status: 'connected' });
  await Promise.resolve();
  assert.equal(laterNotifications, 1);
  assert.deepEqual(errors.map(error => error.message), [
    'initial subscriber failed', 'subscriber failed', 'async subscriber failed'
  ]);
});

test('memoized selectors use caller-owned argument identity invalidation', () => {
  let calls = 0;
  const selector = createMemoizedSelector(values => {
    calls += 1;
    return values.map(value => value * 2);
  });
  const values = [1, 2];
  assert.equal(selector(values), selector(values));
  assert.equal(calls, 1);
  assert.notEqual(selector([1, 2]), selector([1, 2]));
  assert.equal(calls, 3);
  const identitySelector = createMemoizedSelector(value => ({ value }));
  const first = {};
  const second = {};
  const firstResult = identitySelector(first);
  identitySelector(second);
  assert.equal(identitySelector(first), firstResult);
});

test('immediate stores adapt to observer-style subscribables', () => {
  const source = immediateStore('idle');
  const values = [];
  const subscription = createSubscribable(source).subscribe({ next: value => values.push(value) });
  source.set('connected');
  subscription.unsubscribe();
  source.set('closed');
  assert.deepEqual(values, ['idle', 'connected']);
});
