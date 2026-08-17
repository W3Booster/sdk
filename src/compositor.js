import { ConnectionError, PermissionRequiredError, ProtocolError } from './index.js';

const DEFAULT_LOCAL_API = 'https://localhost:25080';
const DEFAULT_CLOUD_API = 'https://app.w3booster.com:14969';
const CONNECTION_TIMEOUT = 5000;

/** Return authenticated child overlays for W3Booster's platform compositor. */
export async function getOverlayComposition(options = {}) {
  if (!globalThis.fetch) return [];
  const browserSource = readBrowserSource(options);
  const surface = options.surface || browserSource?.surface || 'streamOverlay';
  let credential = options.tokenProvider
    ? await options.tokenProvider()
    : (browserSource ? null : readCompositorCredential(surface));
  const bases = options.api ? [normalizeApiBase(options.api, 'api')] : backendUrls(options);
  const errors = [];
  for (let index = 0; index < bases.length; index++) {
    try {
      if (!credential && browserSource) {
        credential = await bootstrapBrowserSourceSession(bases[index], { ...browserSource, surface }, 5000);
      }
      const response = await fetchWithTimeout(`${bases[index]}/stream/v1/composite-launches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(credential ? { Authorization: `Bearer ${credential}` } : {})
        },
        body: JSON.stringify({ surface })
      }, 5000);
      if (!response.ok) throw new Error(`overlay compositor returned ${response.status}`);
      const result = await response.json();
      return Array.isArray(result?.apps) ? result.apps : [];
    } catch (error) {
      errors.push(error);
    }
  }
  if (!credential && !browserSource) return [];
  throw new ConnectionError('Could not load enabled app overlays.', errors);
}

/** Watch changes to the authenticated user's platform overlay composition. */
export async function watchOverlayComposition(options = {}, listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  if (!globalThis.WebSocket) throw new ConnectionError('WebSocket is unavailable.');
  const browserSource = readBrowserSource(options);
  const surface = options.surface || browserSource?.surface || 'streamOverlay';
  let credential = options.tokenProvider
    ? await options.tokenProvider()
    : readCompositorCredential(surface);
  const bases = options.api ? [normalizeApiBase(options.api, 'api')] : backendUrls(options);

  const authorizeWatch = async signal => {
    const errors = [];
    for (let index = 0; index < bases.length; index++) {
      const base = bases[index];
      let candidateCredential = credential;
      const refreshCredential = async () => {
        if (options.tokenProvider) return await options.tokenProvider();
        if (browserSource) return await bootstrapBrowserSourceSession(base, { ...browserSource, surface }, CONNECTION_TIMEOUT, signal);
        return null;
      };
      try {
        if (!candidateCredential) candidateCredential = await refreshCredential();
        if (!candidateCredential) throw new PermissionRequiredError('Overlay session is missing.');
        let response = await requestCompositionWatch(base, surface, candidateCredential, signal);
        if ((response.status === 401 || response.status === 403) && (browserSource || options.tokenProvider)) {
          candidateCredential = await refreshCredential();
          if (!candidateCredential) throw new PermissionRequiredError('Overlay session is missing.');
          response = await requestCompositionWatch(base, surface, candidateCredential, signal);
        }
        if (!response.ok) throw new Error(`overlay composition watch returned ${response.status}`);
        const result = await response.json();
        credential = candidateCredential;
        return { websocketUrl: validateWebSocketUrl(result?.websocketUrl), credential: candidateCredential };
      } catch (error) {
        errors.push(error);
        if (browserSource) credential = null;
      }
    }
    throw new ConnectionError('Could not watch enabled app overlays.', errors);
  };

  return await createCompositionWatcher(authorizeWatch, listener, options.onError);
}

function requestCompositionWatch(base, surface, credential, signal) {
  return fetchWithTimeout(`${base}/stream/v1/composition-watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ surface })
  }, CONNECTION_TIMEOUT, signal);
}

function backendUrls(options = {}) {
  const backend = launchBackendHint() || options.backend || 'cloud';
  const local = normalizeApiBase(options.localApi || DEFAULT_LOCAL_API, 'localApi');
  const cloud = normalizeApiBase(options.cloudApi || DEFAULT_CLOUD_API, 'cloudApi');
  if (backend === 'local') return [local];
  if (backend === 'cloud') return [cloud];
  if (backend !== 'auto') return [normalizeApiBase(backend, 'backend')];
  return [local, cloud];
}

function launchBackendHint() {
  try {
    const backend = new URLSearchParams(globalThis.location?.search || '').get('backend');
    return backend === 'local' || backend === 'cloud' ? backend : null;
  } catch (_) {
    return null;
  }
}

function normalizeApiBase(value, optionName) {
  let url;
  try { url = new URL(String(value || '')); }
  catch (_) { throw new TypeError(`${optionName} must be a valid HTTP(S) URL`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`${optionName} must be an HTTP(S) URL`);
  if (url.username || url.password) throw new TypeError(`${optionName} may not contain user information`);
  if (url.search || url.hash) throw new TypeError(`${optionName} may not contain a query or fragment`);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !local) throw new TypeError(`${optionName} must use HTTPS unless it targets localhost`);
  return url.toString().replace(/\/$/, '');
}

function readBrowserSource(options) {
  if (options.browserSource) return options.browserSource;
  if (!globalThis.location) return null;
  const parameters = new URLSearchParams(globalThis.location.search);
  const channel = parameters.get('channel');
  const secret = parameters.get('secret');
  if (!channel || !secret) return null;
  const surface = parameters.has('w3hwnd') ? 'ingameOverlay' : 'streamOverlay';
  return { channel, secret, surface };
}

async function bootstrapBrowserSourceSession(baseUrl, connection, timeout = CONNECTION_TIMEOUT, signal) {
  const response = await fetchWithTimeout(`${baseUrl}/stream/v1/compositor-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: connection.channel,
      secret: connection.secret,
      surface: connection.surface || 'streamOverlay'
    })
  }, timeout, signal);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new PermissionRequiredError(body.error || 'This browser source is not authorized.');
    }
    throw new Error(`overlay session broker returned ${response.status}`);
  }
  const result = await response.json();
  if (!result?.sessionToken) throw new Error('Overlay session broker returned no credential.');
  storeCompositorCredential(connection.surface || 'streamOverlay', result.sessionToken);
  return result.sessionToken;
}

function readCompositorCredential(surface) {
  try { return globalThis.sessionStorage?.getItem(`w3booster.compositor.${surface}`) || null; } catch (_) { return null; }
}

function storeCompositorCredential(surface, credential) {
  try { globalThis.sessionStorage?.setItem(`w3booster.compositor.${surface}`, credential); } catch (_) { }
}

async function fetchWithTimeout(url, options, timeout, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function validateWebSocketUrl(value) {
  let url;
  try { url = new URL(String(value || '')); }
  catch (_) { throw new ProtocolError('INVALID_TICKET', 'The stream broker returned an invalid WebSocket URL.'); }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw new ProtocolError('INVALID_TICKET', 'The stream broker returned an unsupported WebSocket URL.');
  }
  if (url.username || url.password) throw new ProtocolError('INVALID_TICKET', 'WebSocket URLs may not contain user information.');
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'ws:' && !local) throw new ProtocolError('INSECURE_TICKET', 'Remote W3Booster streams must use WSS.');
  return url.toString();
}

function createCompositionWatcher(authorizeWatch, listener, onError) {
  let socket;
  let pendingSocket;
  let reconnectTimer;
  let heartbeatTimer;
  let reconnectAttempt = 0;
  let stopped = false;
  const controller = new AbortController();

  const watcher = {
    close() {
      stopped = true;
      controller.abort();
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
      pendingSocket?.close();
      socket?.close();
      pendingSocket = null;
      socket = null;
    }
  };

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(5000, 250 * (2 ** reconnectAttempt++));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect(false);
    }, delay);
  }

  async function connect(initial) {
    try {
      const authorization = await authorizeWatch(controller.signal);
      if (stopped) return watcher;
      return await openSocket(authorization.websocketUrl, authorization.credential, initial);
    } catch (error) {
      if (stopped || error?.name === 'AbortError') {
        if (initial) throw error;
        return watcher;
      }
      if (initial) {
        stopped = true;
        controller.abort();
        pendingSocket?.close();
        throw error;
      }
      onError?.(error);
      scheduleReconnect();
      return watcher;
    }
  }

  function openSocket(websocketUrl, credential, initial) {
    return new Promise((resolve, reject) => {
      const candidate = new WebSocket(websocketUrl, ['w3booster-compositor', credential]);
      pendingSocket = candidate;
      let opened = false;
      let settled = false;
      let lastHeartbeat = Date.now();

      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        controller.signal.removeEventListener('abort', abort);
        if (pendingSocket === candidate) pendingSocket = null;
        callback(value);
      };
      const abort = () => {
        settle(reject, createAbortError());
        candidate.close();
      };
      const openTimer = setTimeout(() => {
        const error = new ConnectionError('Overlay composition watch did not open in time.');
        settle(reject, error);
        candidate.close();
      }, CONNECTION_TIMEOUT);
      if (controller.signal.aborted) return abort();
      controller.signal.addEventListener('abort', abort, { once: true });

      candidate.addEventListener('open', () => {
        if (stopped) return abort();
        opened = true;
        socket = candidate;
        reconnectAttempt = 0;
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (candidate.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastHeartbeat > 5000) {
            candidate.close();
            return;
          }
          candidate.send(JSON.stringify({ type: 'composition.ping' }));
        }, 2000);
        settle(resolve, watcher);
      }, { once: true });
      candidate.addEventListener('message', event => {
        try {
          const message = JSON.parse(String(event.data));
          if (message?.type === 'composition.pong') {
            lastHeartbeat = Date.now();
            return;
          }
          if (message?.type === 'composition.ready' || message?.type === 'composition.changed') listener(message);
        } catch (error) {
          onError?.(error);
        }
      });
      candidate.addEventListener('error', () => {
        const error = new ConnectionError('Overlay composition watch failed.');
        if (!opened) {
          settle(reject, error);
          candidate.close();
        }
        else onError?.(error);
      });
      candidate.addEventListener('close', () => {
        clearInterval(heartbeatTimer);
        if (socket === candidate) socket = null;
        if (!opened) settle(reject, new ConnectionError('Overlay composition watch closed before connecting.'));
        if (stopped) return;
        if (opened) scheduleReconnect();
      });
    });
  }

  return connect(true);
}

function createAbortError() {
  if (typeof globalThis.DOMException === 'function') return new DOMException('Overlay composition watch was closed.', 'AbortError');
  const error = new Error('Overlay composition watch was closed.');
  error.name = 'AbortError';
  return error;
}
