import { createClient, openClient } from './index.js';
import { createAbortError, isPlainObject, validateAbortSignal } from './internal/network.js';
import { ConnectionError } from './internal/errors.js';
import { isKnownScope } from './internal/scopes.js';
import { normalizeStartupOptions, waitForStartupState } from './internal/startup.js';
import { resolveSettings } from './settings.js';
import { registerConsumerIssueReporter, reportConsumerIssue } from './internal/consumer-issues.js';

/**
 * Bind immutable public application metadata to the SDK runtime.
 * Generated files contain only schema-derived types and data; connection,
 * startup, and settings-resolution behavior stays versioned with the SDK.
 *
 * @type {typeof import('./app-contracts.js').defineApplication}
 */
export const defineApplication = definition => {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('application definition must be an object');
  }
  const clientId = String(definition.clientId || '').trim();
  const revision = String(definition.revision || '').trim();
  if (!clientId) throw new TypeError('application definition clientId is required');
  if (!revision) throw new TypeError('application definition revision is required');
  if (!Array.isArray(definition.scopes) || definition.scopes.some(scope => !isKnownScope(scope))) {
    throw new TypeError('application definition scopes must contain only known W3Booster scopes');
  }
  if (new Set(definition.scopes).size !== definition.scopes.length) {
    throw new TypeError('application definition scopes must not contain duplicates');
  }
  if (!definition.settingsDefaults || typeof definition.settingsDefaults !== 'object' || Array.isArray(definition.settingsDefaults)) {
    throw new TypeError('application definition settingsDefaults must be an object');
  }

  const metadata = Object.freeze({
    clientId,
    revision,
    scopes: Object.freeze([...definition.scopes]),
    settingsDefaults: resolveSettings(definition.settingsDefaults)
  });
  const emptySettings = Object.freeze({});
  const resolvedSettings = new WeakMap();

  const application = {
    ...metadata,
    open(options = {}) {
      return openClient(bindOptions(options, metadata));
    },
    connect(options = {}) {
      return application.open(options);
    },
    createClient(options = {}) {
      return createClient(bindOptions(options, metadata));
    },
    async start(options = {}, startup = {}) {
      const client = application.createClient(options);
      try {
        // The connection options own the established client lifetime. A
        // separate startup signal cancels only incomplete startup.
        await client.start(startup);
        return client;
      } catch (error) {
        await client.disconnect();
        throw error;
      }
    },
    createRuntime(options = {}) {
      return createApplicationRuntime(application, options);
    },
    resolveSettings(settings = emptySettings) {
      const cacheable = isDeepFrozen(settings);
      const cached = cacheable ? resolvedSettings.get(settings) : undefined;
      if (cached) return cached;
      const resolved = resolveSettings(metadata.settingsDefaults, settings);
      if (cacheable) resolvedSettings.set(settings, resolved);
      return resolved;
    },
    settingsFor(state) {
      return application.resolveSettings(state?.application?.settings);
    }
  };
  // TypeScript cannot infer the settings generic through this dynamically
  // assembled frozen facade; the exported function annotation enforces it.
  // @ts-expect-error Runtime validation above preserves the declared generic.
  return Object.freeze(application);
};

function createApplicationRuntime(application, options) {
  if (!isPlainObject(options)) throw new TypeError('application connection options must be an object');
  validateAbortSignal(options.signal);
  const externalSignal = options.signal;
  const lifetime = new AbortController();
  const client = application.createClient({ ...options, signal: lifetime.signal });
  const subscribers = new Set();
  let stopped = false;
  let stopPromise = null;
  let lifecycle = client.lifecycle.get();
  let host = client.host.lifecycle.get();
  let snapshot = makeRuntimeSnapshot(application, client, lifecycle, host);
  let deferredPublish = false;

  const publish = () => {
    const next = makeRuntimeSnapshot(application, client, lifecycle, host);
    if (sameRuntimeSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...subscribers]) notify(client, listener, snapshot);
  };
  const deferPublish = () => {
    if (deferredPublish) return;
    deferredPublish = true;
    queueMicrotask(() => {
      deferredPublish = false;
      publish();
    });
  };
  const unsubscribeClient = client.lifecycle.subscribe(next => {
    lifecycle = next;
    // Client teardown updates the client and host stores back-to-back. Hold
    // whichever half arrives first so the aggregate never exposes a terminal
    // client with a live host, or a live client with a torn-down host.
    if (isTerminalStatus(lifecycle.status) && host.available) deferPublish();
    else publish();
  });
  const unsubscribeHost = client.host.lifecycle.subscribe(next => {
    const wasAvailable = host.available;
    host = next;
    if (wasAvailable && !host.available && !isTerminalStatus(lifecycle.status)) deferPublish();
    else publish();
  });

  const runtime = {
    client,
    signal: lifetime.signal,
    lifecycle: Object.freeze({
      get: () => snapshot,
      subscribe(listener, subscriptionOptions = {}) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        if (!isPlainObject(subscriptionOptions)) throw new TypeError('subscription options must be an object');
        validateAbortSignal(subscriptionOptions.signal);
        if (stopped) throw new Error('This W3Booster application runtime has been stopped.');
        if (subscriptionOptions.signal?.aborted) return () => {};
        subscribers.add(listener);
        const unsubscribe = () => {
          subscribers.delete(listener);
          subscriptionOptions.signal?.removeEventListener('abort', unsubscribe);
        };
        subscriptionOptions.signal?.addEventListener('abort', unsubscribe, { once: true });
        notify(client, listener, snapshot);
        return unsubscribe;
      }
    }),
    start(startup = {}) {
      if (stopped) return Promise.reject(new Error('This W3Booster application runtime has been stopped.'));
      return startRuntimeClient(client, startup);
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      lifetime.abort();
      const operation = client.disconnect().finally(() => {
        unsubscribeClient();
        unsubscribeHost();
        externalSignal?.removeEventListener('abort', abortRuntime);
        subscribers.clear();
      });
      stopPromise = operation;
      return operation;
    }
  };
  const abortRuntime = () => { void runtime.stop(); };
  registerConsumerIssueReporter(runtime.lifecycle, error => reportConsumerIssue(client, error));
  if (externalSignal?.aborted) abortRuntime();
  else externalSignal?.addEventListener('abort', abortRuntime, { once: true });
  return Object.freeze(runtime);
}

function makeRuntimeSnapshot(application, client, lifecycle, host) {
  return Object.freeze({
    client,
    ...lifecycle,
    settings: application.resolveSettings(lifecycle.state?.application?.settings),
    host
  });
}

async function startRuntimeClient(client, options) {
  const { until, timeout, signal } = normalizeStartupOptions(options);
  const startedAt = Date.now();
  await waitForRuntimeOpen(client.open(), timeout, signal);
  if (until === 'connected') return client;
  const remainingTimeout = timeout === 0 ? 0 : timeout - (Date.now() - startedAt);
  if (remainingTimeout <= 0 && timeout > 0) throw runtimeStartupTimeout();
  await waitForStartupState(client, client.lifecycle, until, remainingTimeout, signal);
  return client;
}

function waitForRuntimeOpen(operation, timeout, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      callback(value);
    };
    const cancel = () => finish(reject, createAbortError('W3Booster startup was cancelled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    if (!settled && timeout > 0) timer = setTimeout(() => finish(reject, runtimeStartupTimeout()), timeout);
    Promise.resolve(operation).then(
      value => finish(resolve, value),
      error => finish(reject, error)
    );
  });
}

function runtimeStartupTimeout() {
  return new ConnectionError('W3Booster application runtime did not start in time.', [], 'STARTUP_TIMEOUT');
}

function sameRuntimeSnapshot(left, right) {
  return left.client === right.client && left.status === right.status && left.state === right.state &&
    left.isSynchronized === right.isSynchronized && left.error === right.error && left.retry === right.retry &&
    left.settings === right.settings && left.host === right.host;
}

function isTerminalStatus(status) {
  return status === 'closed' || status === 'error';
}

function notify(client, listener, value) {
  try {
    const result = listener(value);
    if (result && typeof result.then === 'function') Promise.resolve(result).catch(error => reportConsumerIssue(client, error));
  } catch (error) { reportConsumerIssue(client, error); }
}

function isDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return false;
  if (!Object.isFrozen(value) || seen.has(value)) return false;
  seen.add(value);
  const frozen = Object.values(value).every(child =>
    !child || typeof child !== 'object' || isDeepFrozen(child, seen));
  seen.delete(value);
  return frozen;
}

function bindOptions(options, metadata) {
  if (!isPlainObject(options)) throw new TypeError('application connection options must be an object');
  if (Array.isArray(options.scopes)) {
    const unavailable = options.scopes.find(scope => !metadata.scopes.includes(scope));
    if (unavailable !== undefined) {
      throw new TypeError(`Scope ${String(unavailable)} is not configured for application ${metadata.clientId}`);
    }
  }
  return {
    ...options,
    clientId: metadata.clientId,
    applicationRevision: metadata.revision
  };
}
