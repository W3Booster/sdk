import { ConnectionError } from './errors.js';
import { createAbortError, isPlainObject, validateAbortSignal } from './network.js';

export class StateStore {
  constructor({ freeze, onListenerError = reportListenerError, onSnapshotChange = () => {} }) {
    this.freeze = freeze;
    this.state = null;
    this.synchronized = false;
    this.subscribers = new Set();
    this.readyWaiters = new Set();
    this.synchronizationWaiters = new Set();
    this.onListenerError = onListenerError;
    this.onSnapshotChange = onSnapshotChange;
  }
  get() { return this.state; }
  get isSynchronized() { return this.synchronized; }
  player(playerId) { return this.state?.players?.find(player => String(player.id) === String(playerId)) || null; }
  subscribe(listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    options = normalizeSubscriptionOptions(options);
    if (options.signal?.aborted) return () => {};
    this.subscribers.add(listener);
    const unsubscribe = () => {
      this.subscribers.delete(listener);
      options.signal?.removeEventListener('abort', unsubscribe);
    };
    options.signal?.addEventListener('abort', unsubscribe, { once: true });
    this.notify(listener);
    return unsubscribe;
  }
  setState(nextState, options = {}) {
    this.state = this.freeze(nextState);
    if (options.synchronized === true) this.synchronized = true;
    this.publishSnapshot();
    for (const waiter of [...this.readyWaiters]) waiter.resolve(this.state);
    if (this.synchronized) for (const waiter of [...this.synchronizationWaiters]) waiter.resolve(this.state);
    [...this.subscribers].forEach(listener => this.notify(listener));
    return this.state;
  }
  reset(reason = createAbortError('W3Booster state was reset before it became ready.'), options = {}) {
    const hadState = this.state !== null;
    this.state = null;
    this.synchronized = false;
    if (options.publish !== false) this.publishSnapshot();
    if (hadState) [...this.subscribers].forEach(listener => this.notify(listener));
    for (const waiter of [...this.readyWaiters]) waiter.reject(reason);
    for (const waiter of [...this.synchronizationWaiters]) waiter.reject(reason);
  }
  markStale(options = {}) {
    if (!this.synchronized) return false;
    this.synchronized = false;
    if (options.publish !== false) this.publishSnapshot();
    return true;
  }
  markSynchronized(options = {}) {
    if (!this.state || this.synchronized) return false;
    this.synchronized = true;
    if (options.publish !== false) this.publishSnapshot();
    for (const waiter of [...this.synchronizationWaiters]) waiter.resolve(this.state);
    return true;
  }
  publishSnapshot() {
    this.onSnapshotChange({ state: this.state, isSynchronized: this.synchronized });
  }
  notify(listener) {
    try { handleListenerResult(listener(this.state), this.onListenerError); }
    catch (error) { this.onListenerError(error); }
  }
  watch(selector, listener, options) {
    if (typeof selector !== 'function') throw new TypeError('selector must be a function');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    options = normalizeWatchOptions(options ?? {});
    const equals = options.equals ?? Object.is;
    let initialized = false;
    let previous;
    return this.subscribe(state => {
      const selected = selector(state);
      if (!initialized || !equals(previous, selected)) {
        const before = previous;
        previous = selected;
        initialized = true;
        return listener(selected, before, state);
      }
    }, options);
  }
  whenReady(options = {}) {
    return this.waitForState(this.readyWaiters, () => !!this.state, options, 'ready');
  }
  whenSynchronized(options = {}) {
    return this.waitForState(this.synchronizationWaiters, () => !!this.state && this.synchronized, options, 'synchronized');
  }
  waitForState(waiters, condition, options, expectation) {
    if (!isPlainObject(options)) throw new TypeError('whenReady options must be an object');
    validateAbortSignal(options.signal);
    const timeout = options.timeout === undefined ? 10000 : Number(options.timeout);
    if (!Number.isFinite(timeout) || timeout < 0) throw new TypeError('timeout must be a non-negative number');
    if (options.signal?.aborted) return Promise.reject(createAbortError('Waiting for W3Booster state was cancelled.'));
    if (condition()) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: state => { cleanup(); resolve(state); },
        reject: error => { cleanup(); reject(error); }
      };
      const abort = () => waiter.reject(createAbortError('Waiting for W3Booster state was cancelled.'));
      let timer;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        waiters.delete(waiter);
      };
      waiters.add(waiter);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (timeout > 0) {
        timer = setTimeout(() => {
          const message = expectation === 'synchronized'
            ? 'W3Booster did not synchronize fresh state in time.'
            : 'W3Booster did not provide its initial state in time.';
          waiter.reject(new ConnectionError(message, [], 'STATE_TIMEOUT'));
        }, timeout);
      }
    });
  }
}

export class ClientLifecycleStore {
  constructor(onListenerError = reportListenerError) {
    this.snapshot = Object.freeze({ status: 'idle', state: null, isSynchronized: false, error: null });
    this.subscribers = new Set();
    this.onListenerError = onListenerError;
  }
  get() { return this.snapshot; }
  subscribe(listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    options = normalizeSubscriptionOptions(options);
    if (options.signal?.aborted) return () => {};
    this.subscribers.add(listener);
    const unsubscribe = () => {
      this.subscribers.delete(listener);
      options.signal?.removeEventListener('abort', unsubscribe);
    };
    options.signal?.addEventListener('abort', unsubscribe, { once: true });
    this.notify(listener);
    return unsubscribe;
  }
  update(patch) {
    const next = Object.freeze({ ...this.snapshot, ...patch });
    if (next.status === this.snapshot.status && next.state === this.snapshot.state &&
        next.isSynchronized === this.snapshot.isSynchronized && next.error === this.snapshot.error) return;
    this.snapshot = next;
    [...this.subscribers].forEach(listener => this.notify(listener));
  }
  notify(listener) {
    try { handleListenerResult(listener(this.snapshot), this.onListenerError); }
    catch (error) { this.onListenerError(error); }
  }
}

export class W3BoosterEventEmitter {
  constructor(onListenerError = reportListenerError) {
    this.listeners = new Map();
    this.unknownListeners = new Map();
    this.onListenerError = onListenerError;
  }
  on(type, listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    options = normalizeSubscriptionOptions(options);
    if (options.signal?.aborted) return () => {};
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    const unsubscribe = () => {
      this.listeners.get(type)?.delete(listener);
      if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
      options.signal?.removeEventListener('abort', unsubscribe);
    };
    options.signal?.addEventListener('abort', unsubscribe, { once: true });
    return unsubscribe;
  }
  once(type, listener, options) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const unsubscribe = this.on(type, data => {
      unsubscribe();
      return listener(data);
    }, options);
    return unsubscribe;
  }
  onUnknown(type, listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    options = normalizeSubscriptionOptions(options);
    if (options.signal?.aborted) return () => {};
    if (!this.unknownListeners.has(type)) this.unknownListeners.set(type, new Set());
    this.unknownListeners.get(type).add(listener);
    const unsubscribe = () => {
      this.unknownListeners.get(type)?.delete(listener);
      if (this.unknownListeners.get(type)?.size === 0) this.unknownListeners.delete(type);
      options.signal?.removeEventListener('abort', unsubscribe);
    };
    options.signal?.addEventListener('abort', unsubscribe, { once: true });
    return unsubscribe;
  }
  onceUnknown(type, listener, options) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const unsubscribe = this.onUnknown(type, data => {
      unsubscribe();
      return listener(data);
    }, options);
    return unsubscribe;
  }
  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
    this.unknownListeners.get(type)?.delete(listener);
    if (this.unknownListeners.get(type)?.size === 0) this.unknownListeners.delete(type);
  }
  emit(type, data) {
    const immutableData = freezeEventPayload(data);
    this.callListeners(type, immutableData);
    this.callListeners('*', Object.freeze({ type, data: immutableData }));
  }
  emitUnknown(type, data) {
    this.callListenerSet(this.unknownListeners.get(type), type, freezeEventPayload(data));
  }
  callListeners(type, data) {
    this.callListenerSet(this.listeners.get(type), type, data);
  }
  callListenerSet(listeners, type, data) {
    [...(listeners || [])].forEach(listener => {
      const onError = error => {
        if (type !== 'error' && type !== 'issue' && type !== '*') this.onListenerError(error);
        else reportListenerError(error);
      };
      try { handleListenerResult(listener(data), onError); }
      catch (error) { onError(error); }
    });
  }
}

export function normalizeSubscriptionOptions(options) {
  if (!isPlainObject(options)) throw new TypeError('subscription options must be an object');
  validateAbortSignal(options.signal);
  return options;
}

function normalizeWatchOptions(options) {
  options = normalizeSubscriptionOptions(options);
  if (options.equals !== undefined && typeof options.equals !== 'function') {
    throw new TypeError('watch equals must be a function');
  }
  return options;
}

export function handleListenerResult(result, onError) {
  if (result && typeof result.then === 'function') Promise.resolve(result).catch(onError);
}

function reportListenerError(error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else globalThis.console?.error?.('W3Booster SDK listener failed:', error);
}

/** Freeze JSON-like event envelopes without mutating Error and other host objects. */
function freezeEventPayload(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeEventPayload(child, seen);
  seen.delete(value);
  return Object.freeze(value);
}
