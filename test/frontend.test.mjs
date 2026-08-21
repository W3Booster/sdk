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

test('React adapters preserve a real update emitted synchronously during subscription', () => {
  let value = 'idle';
  const source = {
    get: () => value,
    subscribe(listener) {
      value = 'connected';
      listener(value);
      return () => {};
    }
  };
  const store = createReactStore(source);
  let notifications = 0;

  store.subscribe(() => { notifications += 1; });

  assert.equal(notifications, 1);
  assert.equal(store.getSnapshot(), 'connected');
});

test('selector stores deliver a synchronous subscription update exactly once', () => {
  let value = 'idle';
  const source = {
    get: () => value,
    subscribe(listener) {
      listener(value);
      value = 'connected';
      listener(value);
      return () => {};
    }
  };
  const values = [];
  const store = createSelectorStore(source, snapshot => snapshot);

  store.subscribe(snapshot => values.push(snapshot));

  assert.deepEqual(values, ['connected']);
  assert.equal(store.get(), 'connected');
});

test('selector stores honor aborts triggered by a synchronous startup update', () => {
  let value = 0;
  const sourceListeners = new Set();
  const source = {
    get: () => value,
    subscribe(listener) {
      sourceListeners.add(listener);
      listener(value);
      value = 1;
      listener(value);
      return () => sourceListeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of sourceListeners) listener(value);
    }
  };
  const lifetime = new AbortController();
  const values = [];
  const store = createSelectorStore(source, snapshot => snapshot);

  store.subscribe(snapshot => {
    values.push(snapshot);
    lifetime.abort();
  }, { signal: lifetime.signal });
  source.set(2);

  assert.deepEqual(values, [1]);
  assert.equal(sourceListeners.size, 0);
});

test('selector stores rederive when source metadata changes without replacing the snapshot', () => {
  const snapshot = Object.freeze({ matchId: 'same-match' });
  let synchronized = false;
  const listeners = new Set();
  const source = {
    get: () => snapshot,
    get isSynchronized() { return synchronized; },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setSynchronized(next) {
      synchronized = next;
      for (const listener of listeners) listener(snapshot);
    }
  };
  const values = [];
  const store = createSelectorStore(source, () => source.isSynchronized);
  store.subscribe(value => values.push(value));

  source.setSynchronized(true);

  assert.deepEqual(values, [false, true]);
  assert.equal(store.get(), true);
});

test('selector stores refresh same-identity source metadata after an idle interval', () => {
  const snapshot = Object.freeze({ matchId: 'same-match' });
  let synchronized = false;
  const listeners = new Set();
  const source = {
    get: () => snapshot,
    get isSynchronized() { return synchronized; },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setSynchronized(next) {
      synchronized = next;
      for (const listener of listeners) listener(snapshot);
    }
  };
  const store = createSelectorStore(source, () => source.isSynchronized);
  const firstValues = [];
  const unsubscribe = store.subscribe(value => firstValues.push(value));
  unsubscribe();

  source.setSynchronized(true);
  const resumedValues = [];
  store.subscribe(value => resumedValues.push(value));

  assert.deepEqual(firstValues, [false]);
  assert.deepEqual(resumedValues, [true]);
  assert.equal(store.get(), true);
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

test('selector stores retain their last valid value when selectors or comparators fail', () => {
  const source = immediateStore({ status: 'idle', failSelector: false, failEquals: false });
  const errors = [];
  const store = createSelectorStore(source, snapshot => {
    if (snapshot.failSelector) throw new Error('selector failed');
    return snapshot.status;
  }, {
    equals: (previous, next) => {
      if (source.get().failEquals) throw new Error('comparator failed');
      return previous === next;
    },
    onError: error => errors.push(error)
  });
  const values = [];
  store.subscribe(value => values.push(value));

  source.set({ status: 'selecting', failSelector: true, failEquals: false });
  assert.equal(store.get(), 'idle');
  source.set({ status: 'comparing', failSelector: false, failEquals: true });
  assert.equal(store.get(), 'idle');
  source.set({ status: 'connected', failSelector: false, failEquals: false });

  assert.deepEqual(values, ['idle', 'connected']);
  assert.deepEqual(errors.map(error => error.message), [
    'selector failed', 'selector failed', 'comparator failed', 'comparator failed'
  ]);
});

test('selector stores report initial derivation failures and do not retain failed subscribers', () => {
  const initialErrors = [];
  assert.throws(() => createSelectorStore(
    immediateStore('invalid'),
    () => { throw new Error('initial selector failed'); },
    { onError: error => initialErrors.push(error) }
  ), /initial selector failed/);
  assert.deepEqual(initialErrors.map(error => error.message), ['initial selector failed']);

  let subscribeAttempts = 0;
  let retainedNotifications = 0;
  const listeners = new Set();
  const source = {
    get: () => 'ready',
    subscribe(listener) {
      subscribeAttempts += 1;
      if (subscribeAttempts === 1) throw new Error('subscription setup failed');
      listeners.add(listener);
      listener('ready');
      return () => listeners.delete(listener);
    }
  };
  const store = createSelectorStore(source, value => value);
  assert.throws(() => store.subscribe(() => { retainedNotifications += 1; }), /subscription setup failed/);
  const unsubscribe = store.subscribe(() => {});
  for (const listener of listeners) listener('changed');
  assert.equal(retainedNotifications, 0);
  unsubscribe();
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
