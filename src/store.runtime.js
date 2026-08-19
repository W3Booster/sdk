import { consumerIssueReporter, registerConsumerIssueReporter } from './internal/consumer-issues.js';

function validateSource(source) {
  if (!source || typeof source.get !== 'function' || typeof source.subscribe !== 'function') {
    throw new TypeError('source must provide get() and subscribe()');
  }
}

function validateSubscriptionOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('subscription options must be an object');
  }
  const signal = options.signal;
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  return options;
}

/** Create a stable, lazily subscribed derived store for every frontend framework. */
export function createSelectorStore(source, selector, options = {}) {
  validateSource(source);
  if (typeof selector !== 'function') throw new TypeError('selector must be a function');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('selector store options must be an object');
  }
  const selectorOptions = /** @type {{ equals?: Function, onError?: Function }} */ (options);
  const equals = selectorOptions.equals ?? Object.is;
  if (typeof equals !== 'function') throw new TypeError('equals must be a function');
  const onError = selectorOptions.onError ?? consumerIssueReporter(source) ?? defaultSubscriberError;
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');

  const reportSubscriberError = error => {
    try {
      const result = onError(error);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(defaultSubscriberError);
    }
    catch (reportingError) { defaultSubscriberError(reportingError); }
  };
  let sourceValue;
  let value;
  try {
    sourceValue = source.get();
    value = selector(sourceValue);
  } catch (error) {
    reportSubscriberError(error);
    throw error;
  }
  let unsubscribeSource = null;
  const listeners = new Set();

  const derive = snapshot => {
    try {
      const next = selector(snapshot);
      return { next, changed: !equals(value, next) };
    } catch (error) {
      reportSubscriberError(error);
      return null;
    }
  };
  const read = (force = false) => {
    let snapshot;
    try { snapshot = source.get(); }
    catch (error) {
      reportSubscriberError(error);
      return value;
    }
    if (!force && Object.is(sourceValue, snapshot)) return value;
    const derived = derive(snapshot);
    if (!derived) return value;
    sourceValue = snapshot;
    if (derived.changed) value = derived.next;
    return value;
  };
  const notify = listener => {
    try {
      const result = listener(value);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(reportSubscriberError);
    } catch (error) {
      reportSubscriberError(error);
    }
  };
  const publish = () => {
    for (const listener of [...listeners]) notify(listener);
  };
  const start = () => {
    let subscribing = true;
    let receivedSynchronousInitial = false;
    let publishedSynchronously = false;
    const unsubscribe = source.subscribe(snapshot => {
      if (subscribing && !receivedSynchronousInitial && Object.is(sourceValue, snapshot)) {
        receivedSynchronousInitial = true;
        return;
      }
      const derived = derive(snapshot);
      if (!derived) return;
      sourceValue = snapshot;
      if (derived.changed) value = derived.next;
      if (subscribing && !receivedSynchronousInitial) {
        receivedSynchronousInitial = true;
        return;
      }
      if (derived.changed) {
        publish();
        if (subscribing) publishedSynchronously = true;
      }
    });
    subscribing = false;
    if (typeof unsubscribe !== 'function') throw new TypeError('source.subscribe() must return an unsubscribe function');
    unsubscribeSource = unsubscribe;
    return publishedSynchronously;
  };

  const store = Object.freeze({
    get: read,
    subscribe(listener, subscriptionOptions = {}) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      subscriptionOptions = validateSubscriptionOptions(subscriptionOptions);
      if (subscriptionOptions.signal?.aborted) return () => {};
      listeners.add(listener);
      let notifiedDuringStart = false;
      let startedSource = false;
      try {
        if (!unsubscribeSource) {
          startedSource = true;
          notifiedDuringStart = start();
        }
      } catch (error) {
        listeners.delete(listener);
        throw error;
      }
      const unsubscribe = () => {
        listeners.delete(listener);
        subscriptionOptions.signal?.removeEventListener('abort', unsubscribe);
        if (listeners.size > 0 || !unsubscribeSource) return;
        unsubscribeSource();
        unsubscribeSource = null;
      };
      subscriptionOptions.signal?.addEventListener('abort', unsubscribe, { once: true });
      // A lazy store may have missed same-identity freshness publications
      // while idle. Re-derive once whenever its source subscription restarts.
      read(startedSource);
      if (!notifiedDuringStart) notify(listener);
      return unsubscribe;
    }
  });
  registerConsumerIssueReporter(store, onError);
  return store;
}

/** Cache the last selector result by argument identity. Inputs must be treated as immutable. */
export function createMemoizedSelector(selector) {
  if (typeof selector !== 'function') throw new TypeError('selector must be a function');
  const identityCache = new WeakMap();
  let primitiveArguments;
  let primitiveResult;
  return (...args) => {
    const identity = args[0];
    if ((typeof identity === 'object' && identity !== null) || typeof identity === 'function') {
      let variants = identityCache.get(identity);
      if (!variants) {
        variants = [];
        identityCache.set(identity, variants);
      }
      const existing = variants.find(entry => sameArguments(entry.arguments, args));
      if (existing) return existing.result;
      const result = selector(...args);
      variants.push({ arguments: args.slice(1), result });
      // Bound primitive option variants while the identity key itself remains weak.
      if (variants.length > 16) variants.shift();
      return result;
    }
    if (primitiveArguments && sameArguments(primitiveArguments, [identity, ...args.slice(1)])) return primitiveResult;
    const result = selector(...args);
    primitiveArguments = args;
    primitiveResult = result;
    return result;
  };
}

/** Adapt an immediate SDK store to the standard observer/unsubscribe contract. */
export function createSubscribable(source) {
  validateSource(source);
  return Object.freeze({
    subscribe(observer) {
      if (typeof observer !== 'function' && (!observer || typeof observer !== 'object' || Array.isArray(observer))) {
        throw new TypeError('observer must be a function or observer object');
      }
      const next = typeof observer === 'function' ? observer : observer.next ?? (() => {});
      if (typeof next !== 'function') throw new TypeError('observer.next must be a function');
      const unsubscribe = source.subscribe(value => next.call(observer, value));
      return Object.freeze({ unsubscribe });
    }
  });
}

function sameArguments(previous, current) {
  const offset = current.length === previous.length + 1 ? 1 : 0;
  return previous.length + offset === current.length &&
    previous.every((value, index) => Object.is(value, current[index + offset]));
}

function defaultSubscriberError(error) {
  console.error('Unhandled selector-store subscriber error.', error);
}
