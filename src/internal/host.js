import { ConnectionError, HostActionError } from './errors.js';
import { isPlainObject, validateAbortSignal } from './network.js';
import { assertSafeValue, deepFreeze, structuredCloneSafe } from './values.js';

const HOST_ACTION_TIMEOUT = 10000;
const HOST_CONTEXT_LIFETIME = 12 * 60 * 60 * 1000;
const HOST_CAPABILITIES = new Set([
  'window:open', 'window:close', 'match-score:write', 'settings:write', 'resize:report', 'command'
]);

/** Host bridge for application surfaces embedded by W3Booster. */
export class W3BoosterHost {
  constructor(clientId, onListenerError = reportListenerError) {
    this.clientId = clientId;
    this.onListenerError = onListenerError;
    this.authenticated = false;
    this.targetOrigin = '*';
    this._capabilities = Object.freeze([]);
    this._capabilityStatus = 'unavailable';
    this._lifecycleSnapshot = Object.freeze({
      available: false,
      capabilities: this._capabilities,
      capabilityStatus: this._capabilityStatus
    });
    this.capabilitySubscribers = new Set();
    this.lifecycleSubscribers = new Set();
    this.resizeObserver = null;
    this.resizeFrame = null;
    this.resizeListener = null;
    this.domReadyListener = null;
    this.domReadyDocument = null;
    this.pendingRequests = new Map();
    this.requestSequence = 0;
    this.responseListener = event => this.#handleResponse(event);
  }

  get available() { return !!hostWindow(this.authenticated); }
  get capabilities() { return this._capabilities; }
  get capabilityStatus() { return this._capabilityStatus; }
  getLifecycleSnapshot() { return this._lifecycleSnapshot; }
  supports(capability) {
    if (!HOST_CAPABILITIES.has(capability)) throw new TypeError(`Unknown W3Booster host capability: ${String(capability)}`);
    return this._capabilities.includes(capability);
  }
  can(capability) {
    if (!HOST_CAPABILITIES.has(capability)) throw new TypeError(`Unknown W3Booster host capability: ${String(capability)}`);
    return canUseHostCapability(this._lifecycleSnapshot, capability);
  }

  subscribeCapabilities(listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (!isPlainObject(options)) throw new TypeError('subscription options must be an object');
    validateAbortSignal(options.signal);
    if (options.signal?.aborted) return () => {};
    this.capabilitySubscribers.add(listener);
    const unsubscribe = () => {
      this.capabilitySubscribers.delete(listener);
      options.signal?.removeEventListener('abort', unsubscribe);
    };
    options.signal?.addEventListener('abort', unsubscribe, { once: true });
    this.#notifyCapabilityListener(listener);
    return unsubscribe;
  }

  subscribeLifecycle(listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (!isPlainObject(options)) throw new TypeError('subscription options must be an object');
    validateAbortSignal(options.signal);
    if (options.signal?.aborted) return () => {};
    this.lifecycleSubscribers.add(listener);
    const unsubscribe = () => {
      this.lifecycleSubscribers.delete(listener);
      options.signal?.removeEventListener('abort', unsubscribe);
    };
    options.signal?.addEventListener('abort', unsubscribe, { once: true });
    this.#notifyLifecycleListener(listener);
    return unsubscribe;
  }

  authenticate(context) {
    this.authenticated = context?.trusted === true;
    this.targetOrigin = context?.origin || '*';
    if (this.authenticated) {
      this.#setCapabilityState([], 'pending');
      hostEventTarget()?.addEventListener?.('message', this.responseListener);
      queueMicrotask(() => { if (this.authenticated) void this.refreshCapabilities(); });
    }
  }

  disconnect() {
    this.authenticated = false;
    this.targetOrigin = '*';
    hostEventTarget()?.removeEventListener?.('message', this.responseListener);
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ConnectionError('W3Booster disconnected before the host action completed.', [], 'HOST_UNAVAILABLE'));
    }
    this.pendingRequests.clear();
    this.#setCapabilityState([], 'unavailable');
  }

  openWindow(options = {}) {
    validateOpenWindowOptions(options);
    return this.#requestMessage('host.open-window', { options }, 'opening an application window');
  }
  closeWindow() { return this.#requestMessage('host.close-window', {}, 'closing the application window'); }

  changeMatchScore(side, delta) {
    if (!['wins', 'losses'].includes(side)) throw new TypeError('side must be wins or losses');
    if (![1, -1].includes(delta)) throw new TypeError('delta must be 1 or -1');
    return this.command('overlay.match-score.change', { side, delta });
  }

  resetMatchScore() { return this.command('overlay.match-score.reset'); }

  command(command, payload) {
    if (typeof command !== 'string' || !command.trim() || command.length > 160) {
      throw new TypeError('command must be a non-empty string of at most 160 characters');
    }
    if (payload !== undefined) assertSafeValue(payload, 'host command payload');
    return this.#request(command, payload);
  }

  setSetting(path, value) {
    if (typeof path !== 'string' || path.length > 120 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(path)) {
      throw new TypeError('path must contain dot-separated setting identifiers');
    }
    try { assertSafeValue(value, 'setting value'); }
    catch (error) {
      const invalid = new TypeError('setting value must be JSON-compatible');
      invalid.cause = error;
      throw invalid;
    }
    return this.#request('application.settings.set', { path, value }).then(result => {
      if (!isPlainObject(result?.settings)) throw new HostActionError('The W3Booster host returned invalid saved settings.', 'INVALID_HOST_RESPONSE');
      assertSafeValue(result.settings, 'saved settings');
      return deepFreeze(structuredCloneSafe(result.settings));
    });
  }

  #request(command, payload, options = {}) {
    return this.#requestMessage('host.command', {
      command,
      ...(payload !== undefined ? { payload } : {})
    }, command, options);
  }

  #requestMessage(type, data, action, options = {}) {
    assertSafeValue(data, 'host request');
    const requestId = `${Date.now().toString(36)}-${(++this.requestSequence).toString(36)}`;
    const timeout = options.timeout ?? HOST_ACTION_TIMEOUT;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new ConnectionError(`The W3Booster host did not acknowledge ${action}.`, [], 'HOST_TIMEOUT'));
      }, timeout);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      if (!this.#post(type, { ...data, requestId })) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new ConnectionError('This application is not running inside an authenticated W3Booster host.', [], 'HOST_UNAVAILABLE'));
      }
    });
  }

  async refreshCapabilities() {
    if (!this.authenticated) return this._capabilities;
    if (this._capabilityStatus !== 'known') this.#setCapabilityState(this._capabilities, 'pending');
    try {
      const result = await this.#request('host.capabilities.get');
      if (!this.authenticated) return this._capabilities;
      if (result == null) {
        this.#setCapabilityState([], 'legacy');
        return this._capabilities;
      }
      if (!Array.isArray(result?.capabilities)) throw new TypeError('The W3Booster host returned invalid capabilities.');
      this.#setCapabilityState(result.capabilities.filter(capability => HOST_CAPABILITIES.has(capability)), 'known');
    } catch (error) {
      if (this.authenticated && this._capabilityStatus === 'pending') {
        // Older hosts either acknowledge unknown generic commands without a
        // value or reject them explicitly. Other failures must not enable UI.
        const status = error instanceof HostActionError && error.code === 'UNKNOWN_COMMAND'
          ? 'legacy'
          : 'unavailable';
        this.#setCapabilityState([], status);
      }
    }
    return this._capabilities;
  }

  #setCapabilityState(capabilities, status) {
    const next = Object.freeze(Array.from(new Set(capabilities)));
    const available = this.available;
    const unchanged = next.length === this._capabilities.length &&
      next.every((value, index) => value === this._capabilities[index]) &&
      status === this._capabilityStatus && available === this._lifecycleSnapshot.available;
    if (unchanged) return;
    this._capabilities = next;
    this._capabilityStatus = status;
    this._lifecycleSnapshot = Object.freeze({
      available,
      capabilities: next,
      capabilityStatus: status
    });
    [...this.capabilitySubscribers].forEach(listener => this.#notifyCapabilityListener(listener));
    [...this.lifecycleSubscribers].forEach(listener => this.#notifyLifecycleListener(listener));
  }

  #notifyCapabilityListener(listener) {
    try {
      const result = listener(this._capabilities, this._capabilityStatus);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(this.onListenerError);
    } catch (error) { this.onListenerError(error); }
  }

  #notifyLifecycleListener(listener) {
    try {
      const result = listener(this._lifecycleSnapshot);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(this.onListenerError);
    } catch (error) { this.onListenerError(error); }
  }

  #handleResponse(event) {
    const message = event?.data;
    const target = hostWindow(this.authenticated);
    const sourceMatches = event.source === target || (event.source == null && target?.__w3boosterHostBridge === true);
    if (!target || !sourceMatches || message?.source !== 'w3booster-host' ||
        message.clientId !== this.clientId || message.type !== 'host.response' || typeof message.requestId !== 'string') return;
    const expectedOrigin = this.targetOrigin;
    if (expectedOrigin !== '*' && event.origin !== expectedOrigin) return;
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;
    this.pendingRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new HostActionError(message.error?.message || 'The W3Booster host action failed.', message.error?.code));
  }

  #post(type, data) {
    const target = hostWindow(this.authenticated);
    if (!target) return false;
    try {
      target.postMessage({ source: 'w3booster-sdk', clientId: this.clientId, type, ...data }, this.targetOrigin);
      return true;
    } catch (_) {
      return false;
    }
  }

  startAutoResize() {
    if (!globalThis.document || !hostWindow(this.authenticated) || this.resizeListener) return;
    const report = () => {
      this.resizeFrame = null;
      const root = document.documentElement;
      const body = document.body;
      const height = Math.max(
        root?.scrollHeight || 0,
        root?.offsetHeight || 0,
        body?.scrollHeight || 0,
        body?.offsetHeight || 0
      );
      if (height > 0) this.#post('host.resize', { height });
    };
    this.resizeListener = () => {
      if (this.resizeFrame !== null) return;
      this.resizeFrame = globalThis.requestAnimationFrame
        ? requestAnimationFrame(report)
        : setTimeout(report, 0);
    };
    const observe = () => {
      this.domReadyListener = null;
      this.domReadyDocument = null;
      if (!this.resizeListener) return;
      if (globalThis.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(this.resizeListener);
        if (document.documentElement) this.resizeObserver.observe(document.documentElement);
        if (document.body) this.resizeObserver.observe(document.body);
      }
      globalThis.addEventListener?.('resize', this.resizeListener);
      this.resizeListener();
    };
    if (document.readyState === 'loading') {
      this.domReadyListener = observe;
      this.domReadyDocument = document;
      document.addEventListener('DOMContentLoaded', observe, { once: true });
    } else observe();
  }

  stopAutoResize() {
    if (this.domReadyListener) {
      this.domReadyDocument?.removeEventListener?.('DOMContentLoaded', this.domReadyListener);
      this.domReadyListener = null;
      this.domReadyDocument = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeListener) globalThis.removeEventListener?.('resize', this.resizeListener);
    if (this.resizeFrame !== null) {
      if (globalThis.cancelAnimationFrame) cancelAnimationFrame(this.resizeFrame);
      else clearTimeout(this.resizeFrame);
    }
    this.resizeFrame = null;
    this.resizeListener = null;
  }
}

export function canUseHostCapability(snapshot, capability) {
  if (!HOST_CAPABILITIES.has(capability)) throw new TypeError(`Unknown W3Booster host capability: ${String(capability)}`);
  if (!snapshot?.available || snapshot.capabilityStatus === 'pending' || snapshot.capabilityStatus === 'unavailable') return false;
  return snapshot.capabilityStatus === 'legacy' || snapshot.capabilities?.includes(capability) === true;
}

function validateOpenWindowOptions(options) {
  if (!isPlainObject(options)) throw new TypeError('open window options must be an object');
  assertSafeValue(options, 'open window options');
  for (const field of ['path', 'title']) {
    if (options[field] !== undefined && typeof options[field] !== 'string') {
      throw new TypeError(`open window ${field} must be a string`);
    }
  }
  for (const field of ['width', 'height']) {
    if (options[field] !== undefined && (!Number.isFinite(options[field]) || options[field] <= 0)) {
      throw new TypeError(`open window ${field} must be a positive number`);
    }
  }
}

function hostWindow(authenticated = false) {
  if (!globalThis.window || !authenticated) return null;
  if (window.parent && window.parent !== window) return window.parent;
  return window.opener || null;
}

/** Capture the embedding-window proof before the launch credential is removed from the URL. */
export function captureHostContext(clientId) {
  if (!globalThis.window || !globalThis.location) return Object.freeze({ trusted: false, origin: null });
  try {
    const parameters = new URLSearchParams(globalThis.location.search || '');
    if (parameters.get('w3surface') !== 'application') return Object.freeze({ trusted: false, origin: null });
    const target = window.parent && window.parent !== window ? window.parent : window.opener;
    if (!target) return Object.freeze({ trusted: false, origin: null });
    let bridge = false;
    try { bridge = target.__w3boosterHostBridge === true; } catch (_) { }
    const origin = launchHostOrigin();
    const fragment = new URLSearchParams(globalThis.location.hash?.replace(/^#/, '') || '');
    const freshLaunch = fragment.has('w3session');
    const storageKey = `w3booster.host.${clientId}`;
    if (freshLaunch) {
      try {
        globalThis.sessionStorage?.setItem(storageKey, JSON.stringify({ origin, bridge, expiresAt: Date.now() + HOST_CONTEXT_LIFETIME }));
      } catch (_) { }
      return Object.freeze({ trusted: true, origin });
    }
    let saved;
    try { saved = JSON.parse(globalThis.sessionStorage?.getItem(storageKey) || 'null'); }
    catch (_) { saved = null; }
    const currentContextMatches = saved && Number(saved.expiresAt) > Date.now() && (
      (typeof saved.origin === 'string' && saved.origin.length > 0 && saved.origin === origin) ||
      (saved.bridge === true && bridge)
    );
    return Object.freeze({ trusted: currentContextMatches === true, origin: currentContextMatches ? origin : null });
  } catch (_) {
    return Object.freeze({ trusted: false, origin: null });
  }
}

function hostEventTarget() {
  return globalThis.window?.addEventListener ? globalThis.window : globalThis;
}

function launchHostOrigin() {
  try {
    const origin = new URL(globalThis.document?.referrer || '').origin;
    const applicationOrigin = globalThis.location?.origin;
    return origin && origin !== 'null' && origin !== applicationOrigin ? origin : null;
  } catch (_) {
    return null;
  }
}

function reportListenerError(error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else globalThis.console?.error?.('W3Booster SDK host listener failed:', error);
}
