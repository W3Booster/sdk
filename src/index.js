import { SDK_VERSION, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './version.js';
import { emitDomainEvents, isActiveMatch } from './internal/domain.js';
import { registerConsumerIssueReporter } from './internal/consumer-issues.js';
import { DeferredLocalRecorderTransport } from './internal/deferred-recorder.js';
import {
  ConnectionError,
  classifyW3BoosterError,
  HostActionError,
  isAbortError,
  isRetryableConnectionError,
  PermissionRequiredError,
  ProtocolError
} from './internal/errors.js';
import { createReconnectBackoff } from './internal/websocket.js';
import { createBrokerTransport, createCredentialProvider } from './internal/broker.js';
import { canUseHostCapability, captureHostContext, UNAVAILABLE_HOST_SNAPSHOT, W3BoosterHost } from './internal/host.js';
import { applyPatch, normalizeStatePatch, parseProtocolMessage, validateState } from './internal/protocol.js';
import {
  ClientLifecycleStore,
  handleListenerResult,
  normalizeSubscriptionOptions,
  StateStore,
  W3BoosterEventEmitter
} from './internal/reactive.js';
import {
  backendUrls,
  abortable,
  createAbortError,
  DEFAULT_CLOUD_API,
  DEFAULT_LOCAL_API,
  isPlainObject,
  throwIfAborted,
  validateAbortSignal
} from './internal/network.js';
import { deepEqual, deepFreeze } from './internal/values.js';
import { isKnownScope } from './internal/scopes.js';
import { normalizeStartupOptions, waitForStartupState } from './internal/startup.js';

export { SDK_VERSION, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './version.js';
export {
  ConnectionError,
  classifyW3BoosterError,
  HostActionError,
  isAbortError,
  isW3BoosterError,
  PermissionRequiredError,
  ProtocolError
} from './internal/errors.js';

const APP_SURFACES = new Set(['application', 'streamOverlay', 'ingameOverlay']);
const CLIENT_CONSTRUCTOR_TOKEN = Symbol('W3BoosterClient');

/** Open a W3Booster transport without waiting for hydrated state. */
export async function openClient(options) {
  const client = createClient(options);
  try {
    await client.open();
    return client;
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

/** @deprecated Use openClient() for transport-only startup or startClient() for synchronized state. */
export function connect(options) { return openClient(options); }

/** Create a client and wait for the frontend lifecycle milestone requested by startup options. */
export async function startClient(options, startup = {}) {
  const client = createClient(options);
  try {
    await client.start(startup);
    return client;
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

/** Create a client synchronously so lifecycle listeners can be attached before connecting. */
export function createClient(options) { return new W3BoosterClient(options, CLIENT_CONSTRUCTOR_TOKEN); }

/** Decide whether a host action should be offered from a reactive host snapshot. */
export { canUseHostCapability, UNAVAILABLE_HOST_SNAPSHOT };

export class W3BoosterClient {
  #events;
  #lifecycle;
  #state;
  #host;
  #runtime;

  constructor(options = {}, token) {
    if (token !== CLIENT_CONSTRUCTOR_TOKEN) {
      throw new TypeError('Use createClient(), openClient(), or startClient() to create a W3Booster client.');
    }
    this.#runtime = Object.create(null);
    this.#runtime.options = normalizeConnectOptions(options);
    this.#events = new W3BoosterEventEmitter(error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    }));
    this.events = createEventFacade(this.#events);
    this.#lifecycle = new ClientLifecycleStore(error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    }));
    this.lifecycle = createLifecycleFacade(this.#lifecycle);
    registerConsumerIssueReporter(this.lifecycle, error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    }));
    this.#state = new StateStore({
      freeze: deepFreeze,
      onListenerError: error => this.#reportIssue(error, {
        source: 'listener', severity: 'error', recoverable: true
      }),
      onSnapshotChange: snapshot => this.#lifecycle.update({
        state: snapshot.state,
        isSynchronized: snapshot.isSynchronized,
        ...(snapshot.isSynchronized ? { error: null } : {})
      })
    });
    this.state = createStateFacade(this.#state);
    registerConsumerIssueReporter(this.state, error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    }));
    this.#host = new W3BoosterHost(this.#runtime.options.clientId, error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    }));
    this.host = createHostFacade(this.#host);
    registerConsumerIssueReporter(this.host.lifecycle, error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    }));
    this.#runtime._status = 'idle';
    this.#runtime._diagnostics = { protocolVersion: null, transport: null, localTransport: null };
    const diagnostics = this.#runtime._diagnostics;
    this.diagnostics = Object.freeze({
      sdkVersion: SDK_VERSION,
      get protocolVersion() { return diagnostics.protocolVersion; },
      get transport() { return diagnostics.transport; },
      get localTransport() { return diagnostics.localTransport; }
    });
    this.#runtime.sequence = 0;
    this.#runtime.awaitingSnapshot = false;
    this.#runtime.platformState = null;
    this.#runtime.transport = null;
    this.#runtime.pendingTransport = null;
    this.#runtime.connectPromise = null;
    this.#runtime.disconnectPromise = null;
    this.#runtime.connectionController = null;
    this.#runtime.lifecycleAbortListener = null;
    this.#runtime.connectionGeneration = 0;
    this.#runtime.fatalProtocolError = null;
    this.#runtime.closedTransports = new WeakSet();
    this.#runtime.localRecorderTransport = new DeferredLocalRecorderTransport({
      enabled: this.#runtime.options.localRecorder !== false,
      onUpdates: updates => this.#handleLocalRecorderUpdates(updates),
      onStatus: active => { this.#runtime._diagnostics.localTransport = active ? 'recorder-local' : null; },
      onError: error => this.#reportIssue(error, {
        source: 'recorder', severity: 'warning', recoverable: true
      })
    });
    registerConsumerIssueReporter(this, error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    }));
    Object.freeze(this);
  }

  get status() { return this.#runtime._status; }

  connect(options = {}) { return this.open(options); }

  async open(options = {}) {
    if (!isPlainObject(options)) throw new TypeError('open options must be an object');
    validateAbortSignal(options.signal);
    if (this.#runtime.options.retry?.maxAttempts === Infinity &&
        !this.#runtime.options.signal && !options.signal) {
      throw new TypeError('An AbortSignal is required for an unlimited retry policy');
    }
    throwIfAborted(options.signal);
    if (this.#runtime.disconnectPromise) await abortable(this.#runtime.disconnectPromise, options.signal);
    if (this.#runtime.connectPromise) return abortable(this.#runtime.connectPromise, options.signal);
    if (this.status === 'connected') return this;
    if (this.status === 'reconnecting') return this.#waitForConnected(options.signal);
    if (this.status === 'error' && this.#runtime.transport) {
      const failedTransport = this.#runtime.transport;
      this.#runtime.transport = null;
      await this.#closeTransport(failedTransport);
      this.#runtime._diagnostics.transport = null;
    }
    this.#attachLifecycleSignal();
    const generation = ++this.#runtime.connectionGeneration;
    this.#runtime.fatalProtocolError = null;
    const controller = new AbortController();
    this.#runtime.connectionController = controller;
    const externalSignals = Array.from(new Set([this.#runtime.options.signal, options.signal].filter(Boolean)));
    const abortFromExternalSignal = event => controller.abort(event?.target?.reason);
    for (const signal of externalSignals) {
      if (signal.aborted) abortFromExternalSignal({ target: signal });
      else signal.addEventListener('abort', abortFromExternalSignal, { once: true });
    }
    const attempt = this.#openConnectionWithRetry(generation, controller.signal);
    this.#runtime.connectPromise = attempt;
    try {
      return await attempt;
    } catch (error) {
      if (!isAbortError(error)) {
        const alreadyReported = this.#lifecycle.get().error === error;
        this.#setStatus('error', error);
        if (!alreadyReported) this.#reportIssue(error, {
          source: error instanceof ProtocolError ? 'protocol' : 'connection',
          severity: 'error',
          recoverable: isRetryableConnectionError(error)
        });
      }
      throw error;
    } finally {
      for (const signal of externalSignals) signal.removeEventListener('abort', abortFromExternalSignal);
      if (this.#runtime.connectPromise === attempt) this.#runtime.connectPromise = null;
      if (this.#runtime.connectionController === controller) this.#runtime.connectionController = null;
    }
  }

  /** Connect and wait for the lifecycle milestone needed by a long-lived frontend. */
  async start(options = {}) {
    const { until, timeout, signal } = normalizeStartupOptions(options);
    try {
      await this.open({ signal });
      if (until !== 'connected') await waitForStartupState(this, this.lifecycle, until, timeout, signal);
      return this;
    } catch (error) {
      if (signal?.aborted && signal !== this.#runtime.options.signal) await this.disconnect();
      throw error;
    }
  }

  #waitForConnected(signal) {
    throwIfAborted(signal);
    let unsubscribe;
    let settled = false;
    const operation = new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        unsubscribe?.();
        callback(value);
      };
      const abort = () => finish(reject, createAbortError('Waiting for W3Booster to reconnect was cancelled.'));
      signal?.addEventListener('abort', abort, { once: true });
      unsubscribe = this.#lifecycle.subscribe(snapshot => {
        if (snapshot.status === 'connected') finish(resolve, this);
        else if (snapshot.status === 'error') finish(reject, snapshot.error ?? new ConnectionError(
          'W3Booster could not reconnect.', [], 'UNAVAILABLE'
        ));
        else if (snapshot.status === 'closed') finish(reject, createAbortError(
          'W3Booster disconnected while waiting to reconnect.'
        ));
      });
      if (settled) unsubscribe();
    });
    return operation;
  }

  async #openConnectionWithRetry(generation, signal) {
    let attempt = 1;
    const retryBackoff = this.#runtime.options.retry ? createReconnectBackoff({
      ...this.#runtime.options.retry,
      maxAttempts: this.#runtime.options.retry.maxAttempts - 1
    }) : null;
    while (true) {
      try {
        return await this.#openConnection(generation, signal);
      } catch (error) {
        if (signal.aborted || generation !== this.#runtime.connectionGeneration || isAbortError(error)) throw createAbortError();
        const retry = this.#runtime.options.retry;
        if (!retry || !isRetryableConnectionError(error) || attempt >= retry.maxAttempts) throw error;
        const delay = retryBackoff.nextDelay();
        attempt += 1;
        this.#setStatus('connecting');
        await waitForDelay(delay, signal);
      }
    }
  }

  async #openConnection(generation, signal) {
    throwIfAborted(signal);
    this.#setStatus('connecting');
    let candidates;
    try {
      candidates = this.#runtime.options.transport
        ? [this.#runtime.options.transport]
        : await createTransportCandidates(this.#runtime.options);
    } catch (error) {
      throw error;
    }
    if (!candidates.length) {
      throw new ConnectionError('This environment must provide fetch and WebSocket to connect to W3Booster.', [
        new TypeError('Missing browser transport APIs.')
      ], 'MISSING_BROWSER_API');
    }
    const errors = [];

    for (const transport of candidates) {
      throwIfAborted(signal);
      this.#runtime.closedTransports.delete(transport);
      this.#runtime.pendingTransport = transport;
      try {
        await abortable(transport.open({
          clientId: this.#runtime.options.clientId,
          applicationRevision: this.#runtime.options.applicationRevision,
          scopes: [...this.#runtime.options.scopes],
          protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
          signal,
          onMessage: message => {
            if (generation === this.#runtime.connectionGeneration) this.#handleMessage(message);
          },
          onStatus: status => {
            if (generation === this.#runtime.connectionGeneration) this.#setStatus(status);
          },
          onError: error => {
            if (generation === this.#runtime.connectionGeneration) this.#reportIssue(error, {
              source: 'connection', severity: 'error', recoverable: isRetryableConnectionError(error), affectsLifecycle: true
            });
          }
        }), signal);
        if (this.#runtime.fatalProtocolError) throw this.#runtime.fatalProtocolError;
        throwIfAborted(signal);
        if (generation !== this.#runtime.connectionGeneration) throw createAbortError();
        this.#runtime.pendingTransport = null;
        this.#runtime.transport = transport;
        this.#runtime._diagnostics.transport = transport.name;
        this.#host.authenticate(this.#runtime.options.hostContext);
        if (this.#runtime.options.autoResize !== false) this.#host.startAutoResize();
        this.#setStatus('connected');
        return this;
      } catch (error) {
        if (this.#runtime.pendingTransport === transport) this.#runtime.pendingTransport = null;
        errors.push(error);
        await this.#closeTransport(transport);
        if (signal.aborted || generation !== this.#runtime.connectionGeneration || isAbortError(error)) throw createAbortError();
      }
    }

    const lastError = errors[errors.length - 1];
    if (lastError instanceof PermissionRequiredError) throw lastError;
    if (lastError instanceof ProtocolError && !isRecoverableStreamProtocolError(lastError)) throw lastError;
    if (lastError instanceof ConnectionError &&
        (lastError.code === 'CONFIGURATION' || lastError.code === 'APPLICATION_DEFINITION_MISMATCH')) throw lastError;
    throw new ConnectionError('W3Booster is unavailable.', errors, 'UNAVAILABLE');
  }

  on(type, listener, options) {
    return this.#events.on(type, listener, options);
  }

  onUnknown(type, listener, options) { return this.#events.onUnknown(type, listener, options); }

  /** Subscribe to connection status and receive the current value immediately. */
  subscribeStatus(listener, options) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    options = normalizeSubscriptionOptions(options ?? {});
    if (options.signal?.aborted) return () => {};
    const unsubscribe = this.#events.on('status', listener, options);
    try { handleListenerResult(listener(this.status), error => this.#reportIssue(error, {
      source: 'listener', severity: 'error', recoverable: true
    })); }
    catch (error) { this.#reportIssue(error, { source: 'listener', severity: 'error', recoverable: true }); }
    return unsubscribe;
  }

  /** Observe the current active match immediately and all later match lifecycle transitions. */
  subscribeMatchLifecycle(listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    options = normalizeSubscriptionOptions(options);
    if (options.signal?.aborted) return () => {};
    const notify = observation => {
      try { handleListenerResult(listener(deepFreeze(observation)), error => this.#reportIssue(error, {
        source: 'listener', severity: 'error', recoverable: true
      })); }
      catch (error) { this.#reportIssue(error, { source: 'listener', severity: 'error', recoverable: true }); }
    };
    let previousState = null;
    const unsubscribeState = this.state.subscribe(state => {
      if (!state) {
        previousState = null;
        return;
      }
      const previous = previousState;
      previousState = state;
      const currentActive = isActiveMatch(state.match);
      if (!previous) {
        if (currentActive) notify({
          match: state.match,
          state,
          observedAt: new Date().toISOString(),
          phase: 'started',
          initial: true
        });
        return;
      }
      const previousActive = isActiveMatch(previous.match);
      const sameMatch = previous.match.id === state.match.id;
      const observedAt = new Date().toISOString();
      if (previousActive && (!currentActive || !sameMatch)) notify({
        match: sameMatch ? state.match : previous.match,
        previousMatch: previous.match,
        nextMatch: state.match,
        state,
        observedAt,
        phase: 'ended',
        initial: false
      });
      if (currentActive && (!previousActive || !sameMatch)) notify({
        match: state.match,
        previousMatch: previous.match,
        state,
        observedAt,
        phase: 'started',
        initial: false
      });
    }, options);
    return unsubscribeState;
  }

  once(type, listener, options) { return this.#events.once(type, listener, options); }
  onceUnknown(type, listener, options) { return this.#events.onceUnknown(type, listener, options); }
  off(type, listener) { this.#events.off(type, listener); }
  whenReady(options) { return this.#state.whenReady(options); }
  whenSynchronized(options) { return this.#state.whenSynchronized(options); }

  async disconnect() {
    if (this.#runtime.disconnectPromise) return this.#runtime.disconnectPromise;
    const operation = this.#closeConnection();
    this.#runtime.disconnectPromise = operation;
    try { await operation; }
    finally { if (this.#runtime.disconnectPromise === operation) this.#runtime.disconnectPromise = null; }
  }

  async #closeConnection() {
    const pendingConnection = this.#runtime.connectPromise;
    this.#runtime.connectionGeneration += 1;
    this.#runtime.connectionController?.abort(createAbortError());
    this.#runtime.connectionController = null;
    const transports = new Set([this.#runtime.pendingTransport, this.#runtime.transport].filter(Boolean));
    this.#runtime.pendingTransport = null;
    this.#runtime.transport = null;
    await Promise.allSettled([...transports].map(transport => this.#closeTransport(transport)));
    if (pendingConnection) await Promise.allSettled([pendingConnection]);
    if (this.#runtime.connectPromise === pendingConnection) this.#runtime.connectPromise = null;
    this.#runtime.localRecorderTransport.close();
    this.#runtime.sequence = 0;
    this.#runtime.awaitingSnapshot = false;
    this.#runtime.platformState = null;
    this.#state.reset(
      createAbortError('W3Booster disconnected before the initial state was ready.'),
      { publish: false }
    );
    this.#runtime._diagnostics.protocolVersion = null;
    this.#runtime._diagnostics.transport = null;
    this.#runtime._diagnostics.localTransport = null;
    this.#host.stopAutoResize();
    this.#host.disconnect();
    this.#detachLifecycleSignal();
    this.#setStatus('closed');
  }

  #attachLifecycleSignal() {
    const signal = this.#runtime.options.signal;
    if (!signal || this.#runtime.lifecycleAbortListener) return;
    const abort = () => {
      this.#runtime.connectionController?.abort(signal.reason);
      void this.disconnect();
    };
    this.#runtime.lifecycleAbortListener = abort;
    if (!signal.aborted) signal.addEventListener('abort', abort, { once: true });
  }

  #detachLifecycleSignal() {
    if (!this.#runtime.lifecycleAbortListener) return;
    this.#runtime.options.signal?.removeEventListener('abort', this.#runtime.lifecycleAbortListener);
    this.#runtime.lifecycleAbortListener = null;
  }

  #closeTransport(transport) {
    if (!transport || this.#runtime.closedTransports.has(transport)) return;
    this.#runtime.closedTransports.add(transport);
    return transport.close?.();
  }

  #handleMessage(rawMessage) {
    if (this.#runtime.fatalProtocolError) return;
    let message;
    try {
      message = parseProtocolMessage(rawMessage);
      this.#runtime._diagnostics.protocolVersion = message.version;
    } catch (error) {
      this.#handleProtocolError(error);
      return;
    }

    if (message.sequence && this.#runtime.sequence && message.sequence !== this.#runtime.sequence + 1) {
      const expected = this.#runtime.sequence + 1;
      this.#emit('stream.gap', { expected, received: message.sequence });
      const forwardSnapshot = message.type === 'state.snapshot' && message.sequence > this.#runtime.sequence;
      if (!forwardSnapshot) {
        this.#runtime.sequence = 0;
        this.#runtime.awaitingSnapshot = true;
        this.#state.markStale();
        (this.#runtime.transport || this.#runtime.pendingTransport)?.resync?.();
        return;
      }
    }
    if (message.sequence) this.#runtime.sequence = message.sequence;

    const previousState = this.#state.get();
    const previousPlatformState = this.#runtime.platformState;
    let nextPlatformState;
    try {
      if (message.type === 'state.snapshot') {
        nextPlatformState = validateState(message.data, this.#runtime.options.clientId);
      } else if (message.type === 'state.patch') {
        if (this.#runtime.awaitingSnapshot) return;
        if (!previousPlatformState) throw new ProtocolError('PATCH_WITHOUT_STATE', 'Received a state patch before the initial snapshot.');
        message = { ...message, data: normalizeStatePatch(message.data) };
        nextPlatformState = validateState(applyPatch(previousPlatformState, message.data), this.#runtime.options.clientId, false);
      }
    } catch (error) {
      this.#handleProtocolError(error);
      return;
    }
    if (nextPlatformState) {
      if (message.type === 'state.snapshot') this.#runtime.awaitingSnapshot = false;
      this.#runtime.platformState = nextPlatformState;
      this.#runtime.localRecorderTransport.configure(nextPlatformState);
      let nextState = publicApplicationState(nextPlatformState);
      nextState = this.#runtime.localRecorderTransport.applyTo(nextState);
      nextState = preservePublicOverlayIdentity(previousState, nextState);
      if (nextState === previousState || (previousState && deepEqual(nextState, previousState))) {
        this.#state.markSynchronized();
        return;
      }
      const state = this.#state.setState(nextState, { synchronized: true });
      emitDomainEvents(previousState, state, (type, data) => this.#emit(type, data));
      return;
    }
    this.#events.emitUnknown(message.type, message.data);
  }

  #handleProtocolError(error) {
    const protocolError = error instanceof ProtocolError
      ? error
      : new ProtocolError('INVALID_MESSAGE', error instanceof Error ? error.message : 'The stream message is invalid.', error);
    const recoverable = isRecoverableStreamProtocolError(protocolError);
    this.#runtime.sequence = 0;
    this.#runtime.awaitingSnapshot = recoverable;
    this.#state.markStale({ publish: false });
    if (recoverable) {
      this.#reportIssue(protocolError, {
        source: 'protocol', severity: 'error', recoverable: true, affectsLifecycle: true
      });
      (this.#runtime.transport || this.#runtime.pendingTransport)?.resync?.();
      return;
    }

    this.#runtime.fatalProtocolError = protocolError;
    const failedTransport = this.#runtime.transport || this.#runtime.pendingTransport;
    this.#runtime.transport = null;
    this.#runtime.pendingTransport = null;
    this.#runtime._diagnostics.transport = null;
    this.#runtime._diagnostics.localTransport = null;
    this.#runtime.localRecorderTransport.close();
    this.#setStatus('error', protocolError);
    this.#reportIssue(protocolError, {
      source: 'protocol', severity: 'error', recoverable: false
    });
    void Promise.resolve()
      .then(() => this.#closeTransport(failedTransport))
      .catch(closeError => this.#reportIssue(closeError, {
        source: 'connection', severity: 'warning', recoverable: true
      }));
  }

  #handleLocalRecorderUpdates(updates) {
    const previousState = this.#state.get();
    if (!previousState) return false;
    try {
      let nextState = publicApplicationState(this.#runtime.platformState);
      nextState = this.#runtime.localRecorderTransport.applyTo(nextState);
      nextState = this.#runtime.localRecorderTransport.applyUpdates(nextState, updates);
      nextState = validateState(nextState, this.#runtime.options.clientId, false);
      if (deepEqual(previousState, nextState)) return true;
      const state = this.#state.setState(nextState);
      emitDomainEvents(previousState, state, (type, data) => this.#emit(type, data));
      return true;
    } catch (error) {
      this.#reportIssue(error instanceof ProtocolError
        ? error
        : new ProtocolError('INVALID_LOCAL_UPDATE', 'The local recorder update was invalid.', error), {
        source: 'recorder', severity: 'warning', recoverable: true
      });
      return false;
    }
  }

  #emit(type, data) {
    this.#events.emit(type, data);
  }

  #reportIssue(error, options) {
    const issue = Object.freeze({
      source: options.source,
      severity: options.severity,
      recoverable: options.recoverable,
      error
    });
    if (options.affectsLifecycle) this.#lifecycle.update({
      error,
      state: this.#state.get(),
      isSynchronized: this.#state.isSynchronized
    });
    this.#events.emit('issue', issue);
    this.#events.emit('error', error);
  }

  #setStatus(status, error) {
    let freshnessChanged = false;
    if (status === 'reconnecting' || status === 'error') {
      this.#runtime.sequence = 0;
      this.#runtime.awaitingSnapshot = true;
      freshnessChanged = this.#state.markStale({ publish: false });
    }
    if (status === 'error') {
      this.#host.stopAutoResize();
      this.#host.disconnect();
    }
    const nextError = status === 'connecting' || status === 'connected'
      ? null
      : (arguments.length > 1 ? error : this.#lifecycle.get().error);
    if (this.#runtime._status === status && !freshnessChanged && this.#lifecycle.get().error === nextError) return;
    this.#runtime._status = status;
    this.#lifecycle.update({
      status,
      state: this.#state.get(),
      isSynchronized: this.#state.isSynchronized,
      error: nextError
    });
    this.#emit('status', status);
  }
}

function createStateFacade(store) {
  return Object.freeze({
    get: () => store.get(),
    get isSynchronized() { return store.isSynchronized; },
    player: playerId => store.player(playerId),
    subscribe: (listener, options) => store.subscribe(listener, options),
    watch: (selector, listener, options) => store.watch(selector, listener, options),
    whenReady: options => store.whenReady(options),
    whenSynchronized: options => store.whenSynchronized(options)
  });
}

function createLifecycleFacade(store) {
  return Object.freeze({
    get: () => store.get(),
    subscribe: (listener, options) => store.subscribe(listener, options)
  });
}

function createEventFacade(emitter) {
  return Object.freeze({
    on: (type, listener, options) => emitter.on(type, listener, options),
    onUnknown: (type, listener, options) => emitter.onUnknown(type, listener, options),
    once: (type, listener, options) => emitter.once(type, listener, options),
    onceUnknown: (type, listener, options) => emitter.onceUnknown(type, listener, options),
    off: (type, listener) => emitter.off(type, listener)
  });
}

function createHostFacade(host) {
  return Object.freeze({
    lifecycle: Object.freeze({
      get: () => host.getLifecycleSnapshot(),
      subscribe: (listener, options) => host.subscribeLifecycle(listener, options)
    }),
    get available() { return host.available; },
    get capabilities() { return host.capabilities; },
    get capabilityStatus() { return host.capabilityStatus; },
    supports: capability => host.supports(capability),
    can: capability => host.can(capability),
    refreshCapabilities: options => host.refreshCapabilities(options),
    subscribeCapabilities: (listener, options) => host.subscribeCapabilities(listener, options),
    openWindow: (windowOptions, actionOptions) => host.openWindow(windowOptions, actionOptions),
    closeWindow: options => host.closeWindow(options),
    changeMatchScore: (side, delta, options) => host.changeMatchScore(side, delta, options),
    resetMatchScore: options => host.resetMatchScore(options),
    command: (command, payload, options) => host.command(command, payload, options),
    setSetting: (path, value, options) => host.setSetting(path, value, options),
    startAutoResize: () => host.startAutoResize(),
    stopAutoResize: () => host.stopAutoResize()
  });
}

function normalizeConnectOptions(value) {
  const options = typeof value === 'string' ? { clientId: value } : value;
  if (!options || typeof options !== 'object') throw new TypeError('Connect with a client ID or options object.');
  const clientId = String(options.clientId || '').trim();
  if (!clientId) throw new TypeError('clientId is required');
  if (clientId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(clientId)) throw new TypeError('clientId is invalid');
  let scopes = [];
  if (options.scopes !== undefined && options.scopes !== 'configured') {
    if (!Array.isArray(options.scopes)) throw new TypeError('scopes must be configured or an array');
    scopes = Array.from(new Set(options.scopes.map(String)));
    const unknown = scopes.find(scope => !isKnownScope(scope));
    if (unknown) throw new TypeError(`Unknown W3Booster scope: ${unknown}`);
  }
  validateAbortSignal(options.signal);
  if (options.demo !== undefined && typeof options.demo !== 'boolean' && !isPlainObject(options.demo)) {
    throw new TypeError('demo must be a boolean or options object');
  }
  if (isPlainObject(options.demo)) {
    if (options.demo.interval !== undefined && (!Number.isFinite(Number(options.demo.interval)) || Number(options.demo.interval) < 0)) {
      throw new TypeError('demo.interval must be a non-negative number');
    }
    if (options.demo.settings !== undefined && !isPlainObject(options.demo.settings)) {
      throw new TypeError('demo.settings must be an object');
    }
    if (options.demo.state !== undefined && !isPlainObject(options.demo.state)) {
      throw new TypeError('demo.state must be an object');
    }
    if (options.demo.surface !== undefined && !APP_SURFACES.has(options.demo.surface)) {
      throw new TypeError('demo.surface must be application, streamOverlay, or ingameOverlay');
    }
  }
  if (options.tokenProvider !== undefined && typeof options.tokenProvider !== 'function') {
    throw new TypeError('tokenProvider must be a function');
  }
  if (options.applicationRevision !== undefined &&
      (typeof options.applicationRevision !== 'string' || !options.applicationRevision.trim() || options.applicationRevision.length > 160)) {
    throw new TypeError('applicationRevision must be a non-empty string of at most 160 characters');
  }
  for (const optionName of ['localRecorder', 'autoResize']) {
    if (options[optionName] !== undefined && typeof options[optionName] !== 'boolean') {
      throw new TypeError(`${optionName} must be a boolean`);
    }
  }
  if (options.backend !== undefined && !['auto', 'local', 'cloud'].includes(options.backend)) {
    throw new TypeError('backend must be auto, local, or cloud');
  }
  if (options.backendUrl !== undefined && (typeof options.backendUrl !== 'string' || !options.backendUrl.trim())) {
    throw new TypeError('backendUrl must be a non-empty string');
  }
  if (options.backendUrl !== undefined && options.backend !== undefined) {
    throw new TypeError('Use either backend or backendUrl, not both');
  }
  const retry = normalizeRetryOptions(options.retry);
  const reconnect = normalizeReconnectOptions(options.reconnect);
  return {
    ...options,
    clientId,
    scopes,
    retry,
    reconnect,
    hostContext: options.demo ? Object.freeze({ trusted: false, origin: null }) : captureHostContext(clientId)
  };
}

function normalizeRetryOptions(value) {
  if (value === undefined || value === false) return null;
  if (value !== true && !isPlainObject(value)) {
    throw new TypeError('retry must be a boolean or options object');
  }
  const input = value === true ? {} : value;
  const maxAttempts = input.maxAttempts === undefined ? Infinity : Number(input.maxAttempts);
  const initialDelay = input.initialDelay === undefined ? 250 : Number(input.initialDelay);
  const maxDelay = input.maxDelay === undefined ? 5000 : Number(input.maxDelay);
  if (maxAttempts !== Infinity && (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)) {
    throw new TypeError('retry.maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(initialDelay) || initialDelay < 0) throw new TypeError('retry.initialDelay must be a non-negative number');
  if (!Number.isFinite(maxDelay) || maxDelay < initialDelay) throw new TypeError('retry.maxDelay must be at least retry.initialDelay');
  return { maxAttempts, initialDelay, maxDelay };
}

function normalizeReconnectOptions(value) {
  if (value === false) return null;
  if (value !== undefined && value !== true && !isPlainObject(value)) {
    throw new TypeError('reconnect must be a boolean or options object');
  }
  const input = value === undefined || value === true ? {} : value;
  const maxAttempts = input.maxAttempts === undefined ? Infinity : Number(input.maxAttempts);
  const initialDelay = input.initialDelay === undefined ? 500 : Number(input.initialDelay);
  const maxDelay = input.maxDelay === undefined ? 10000 : Number(input.maxDelay);
  if (maxAttempts !== Infinity && (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)) {
    throw new TypeError('reconnect.maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(initialDelay) || initialDelay < 0) throw new TypeError('reconnect.initialDelay must be a non-negative number');
  if (!Number.isFinite(maxDelay) || maxDelay < initialDelay) throw new TypeError('reconnect.maxDelay must be at least reconnect.initialDelay');
  return { maxAttempts, initialDelay, maxDelay };
}

async function createTransportCandidates(options) {
  const candidates = [];
  if (options.demo) {
    const { createDemoTransport } = await import('./testing.js');
    candidates.push(createDemoTransport(typeof options.demo === 'object' ? options.demo : {}));
    return candidates;
  }
  // Validate configured endpoints independently of runtime transport support.
  // This keeps configuration errors deterministic in older Node.js versions
  // and browsers that do not expose a native WebSocket implementation.
  const urls = backendUrls(options);
  if (globalThis.fetch && globalThis.WebSocket) {
    const credentialProvider = createCredentialProvider(options);
    urls.forEach((url, index) => {
      const name = url === (options.localApi || DEFAULT_LOCAL_API) ? 'local'
        : (url === (options.cloudApi || DEFAULT_CLOUD_API) ? 'cloud' : `backend-${index + 1}`);
      candidates.push(createBrokerTransport(name, url, credentialProvider, options.reconnect));
    });
  }
  return candidates;
}

function waitForDelay(delay, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, delay);
    const abort = () => { cleanup(); reject(createAbortError()); };
    function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    function finish() { cleanup(); resolve(); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function isRecoverableStreamProtocolError(error) {
  return !['UNSUPPORTED_PROTOCOL', 'APPLICATION_MISMATCH'].includes(error.code);
}

/** Remove platform control-plane and legacy fields before state reaches applications. */
function publicApplicationState(state) {
  const overlay = state?.overlay;
  if (!overlay) return state;
  const platformRuntime = overlay.misc ?? overlay.runtime ?? {};
  const publicRuntime = { ...platformRuntime };
  const wins = Number(publicRuntime.matchscoreWins);
  const losses = Number(publicRuntime.matchscoreLosses);
  delete publicRuntime.localServerUrls;
  delete publicRuntime.matchscoreWins;
  delete publicRuntime.matchscoreLosses;
  if (Number.isFinite(wins) || Number.isFinite(losses)) {
    publicRuntime.matchScore = Object.freeze({
      wins: Number.isFinite(wins) ? wins : 0,
      losses: Number.isFinite(losses) ? losses : 0
    });
  }
  const publicOverlay = { ...overlay, runtime: publicRuntime };
  delete publicOverlay.misc;
  delete publicOverlay.settings;
  return { ...state, overlay: publicOverlay };
}

/** Preserve application-visible overlay branches when only hidden platform data changed. */
function preservePublicOverlayIdentity(previousState, nextState) {
  const previousOverlay = previousState?.overlay;
  const nextOverlay = nextState?.overlay;
  if (!previousOverlay || !nextOverlay || previousOverlay === nextOverlay) return nextState;

  let overlay = nextOverlay;
  if (previousOverlay.runtime !== nextOverlay.runtime && deepEqual(previousOverlay.runtime, nextOverlay.runtime)) {
    overlay = { ...nextOverlay, runtime: previousOverlay.runtime };
  }
  if (deepEqual(previousOverlay, overlay)) overlay = previousOverlay;
  return overlay === nextOverlay ? nextState : { ...nextState, overlay };
}
