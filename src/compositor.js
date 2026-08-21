import { ConnectionError, isRetryableConnectionError, PermissionRequiredError, ProtocolError } from './internal/errors.js';
import {
  backendUrls,
  CONNECTION_TIMEOUT,
  createAbortError,
  fetchJsonWithTimeout as fetchJson,
  isPlainObject,
  throwIfAborted,
  validateAbortSignal
} from './internal/network.js';
import { createReconnectBackoff, validateWebSocketUrl } from './internal/websocket.js';

/** Return authenticated child overlays for W3Booster's platform compositor. */
export async function getOverlayComposition(options = {}) {
  options = normalizeCompositionOptions(options);
  throwIfAborted(options.signal);
  const browserSource = readBrowserSource(options);
  const surface = options.surface || browserSource?.surface || 'streamOverlay';
  let credential = browserSource || options.tokenProvider ? null : readCompositorCredential(surface);
  const bases = backendUrls(options);
  if (!globalThis.fetch) throw new ConnectionError('Fetch is unavailable.');
  const errors = [];
  for (let index = 0; index < bases.length; index++) {
    const base = bases[index];
    try {
      const refreshCredential = async () => {
        if (options.tokenProvider) return await options.tokenProvider();
        if (browserSource) return await bootstrapBrowserSourceSession(base, { ...browserSource, surface }, CONNECTION_TIMEOUT, options.signal);
        return null;
      };
      let candidateCredential = options.tokenProvider ? null : credential;
      if (!candidateCredential) candidateCredential = await refreshCredential();
      if (!candidateCredential && (browserSource || options.tokenProvider)) throw new PermissionRequiredError('Overlay session is missing.');
      let result = await requestCompositeLaunches(base, surface, candidateCredential, options.signal);
      if ((result.response.status === 401 || result.response.status === 403) && (browserSource || options.tokenProvider)) {
        candidateCredential = await refreshCredential();
        if (!candidateCredential) throw new PermissionRequiredError('Overlay session is missing.');
        result = await requestCompositeLaunches(base, surface, candidateCredential, options.signal);
      }
      if (result.response.status === 401 || result.response.status === 403) {
        throw new PermissionRequiredError('Overlay composition is not authorized.', result.body?.authorizeUrl);
      }
      if (!result.response.ok) throw compositorResponseError('Overlay compositor', result.response);
      credential = candidateCredential;
      return validateCompositionApps(result.body);
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw createAbortError();
      errors.push(error);
      if (browserSource) credential = null;
    }
  }
  if (!credential && !browserSource && !options.tokenProvider &&
      errors.length > 0 && errors.every(error => error instanceof PermissionRequiredError)) return [];
  throw compositorFailure('Could not load enabled app overlays.', errors);
}

/** Watch changes to the authenticated user's platform overlay composition. */
export async function watchOverlayComposition(options = {}, listener) {
  options = normalizeCompositionOptions(options);
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  throwIfAborted(options.signal);
  const browserSource = readBrowserSource(options);
  const surface = options.surface || browserSource?.surface || 'streamOverlay';
  let credential = options.tokenProvider ? null : readCompositorCredential(surface);
  const bases = backendUrls(options);
  if (!globalThis.fetch) throw new ConnectionError('Fetch is unavailable.');
  if (!globalThis.WebSocket) throw new ConnectionError('WebSocket is unavailable.');

  const authorizeWatch = async signal => {
    throwIfAborted(signal);
    const errors = [];
    for (let index = 0; index < bases.length; index++) {
      const base = bases[index];
      const refreshCredential = async () => {
        if (options.tokenProvider) return await options.tokenProvider();
        if (browserSource) return await bootstrapBrowserSourceSession(base, { ...browserSource, surface }, CONNECTION_TIMEOUT, signal);
        return null;
      };
      try {
        let candidateCredential = options.tokenProvider ? null : credential;
        if (!candidateCredential) candidateCredential = await refreshCredential();
        if (!candidateCredential) throw new PermissionRequiredError('Overlay session is missing.');
        let result = await requestCompositionWatch(base, surface, candidateCredential, signal);
        if ((result.response.status === 401 || result.response.status === 403) && (browserSource || options.tokenProvider)) {
          candidateCredential = await refreshCredential();
          if (!candidateCredential) throw new PermissionRequiredError('Overlay session is missing.');
          result = await requestCompositionWatch(base, surface, candidateCredential, signal);
        }
        if (result.response.status === 401 || result.response.status === 403) {
          throw new PermissionRequiredError('Overlay composition watch is not authorized.', result.body?.authorizeUrl);
        }
        if (!result.response.ok) throw compositorResponseError('Overlay composition watch', result.response);
        credential = candidateCredential;
        return { websocketUrl: validateWebSocketUrl(result.body?.websocketUrl), credential: candidateCredential };
      } catch (error) {
        errors.push(error);
        if (browserSource) credential = null;
      }
    }
    throw compositorFailure('Could not watch enabled app overlays.', errors);
  };

  return await createCompositionWatcher(authorizeWatch, listener, options.onError, options.signal);
}

function requestCompositionWatch(base, surface, credential, signal) {
  return fetchJsonWithTimeout(`${base}/stream/v1/composition-watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ surface })
  }, CONNECTION_TIMEOUT, signal);
}

function requestCompositeLaunches(base, surface, credential, signal) {
  return fetchJsonWithTimeout(`${base}/stream/v1/composite-launches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(credential ? { Authorization: `Bearer ${credential}` } : {})
    },
    body: JSON.stringify({ surface })
  }, CONNECTION_TIMEOUT, signal);
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

function normalizeCompositionOptions(value) {
  if (!isPlainObject(value)) throw new TypeError('composition options must be an object');
  validateAbortSignal(value.signal);
  if (value.tokenProvider !== undefined && typeof value.tokenProvider !== 'function') {
    throw new TypeError('tokenProvider must be a function');
  }
  if (value.onError !== undefined && typeof value.onError !== 'function') {
    throw new TypeError('onError must be a function');
  }
  if (value.surface !== undefined && value.surface !== 'streamOverlay' && value.surface !== 'ingameOverlay') {
    throw new TypeError('surface must be streamOverlay or ingameOverlay');
  }
  if (value.backend !== undefined && !['auto', 'local', 'cloud'].includes(value.backend)) {
    throw new TypeError('backend must be auto, local, or cloud');
  }
  if (value.backendUrl !== undefined && (typeof value.backendUrl !== 'string' || !value.backendUrl.trim())) {
    throw new TypeError('backendUrl must be a non-empty string');
  }
  if (value.backendUrl !== undefined && value.backend !== undefined) {
    throw new TypeError('Use either backend or backendUrl, not both');
  }
  if (value.browserSource !== undefined) validateBrowserSource(value.browserSource);
  return value;
}

function validateBrowserSource(value) {
  if (!isPlainObject(value) || typeof value.channel !== 'string' || !value.channel.trim() ||
      typeof value.secret !== 'string' || !value.secret.trim()) {
    throw new TypeError('browserSource must contain a channel and secret');
  }
  if (value.surface !== undefined && value.surface !== 'streamOverlay' && value.surface !== 'ingameOverlay') {
    throw new TypeError('browserSource.surface must be streamOverlay or ingameOverlay');
  }
}

function validateCompositionApps(body) {
  if (!isPlainObject(body) || !Array.isArray(body.apps)) {
    throw new ProtocolError('INVALID_RESPONSE', 'The overlay composition response must contain an apps array.');
  }
  return body.apps.map((app, index) => {
    if (!isPlainObject(app) || typeof app.appId !== 'string' || !app.appId ||
        typeof app.clientId !== 'string' || !app.clientId || typeof app.name !== 'string' ||
        typeof app.url !== 'string' || !app.url ||
        (app.development !== undefined && typeof app.development !== 'boolean')) {
      throw new ProtocolError('INVALID_RESPONSE', `Overlay composition app ${index} is invalid.`);
    }
    let url;
    try { url = new URL(app.url); }
    catch (_) { throw new ProtocolError('INVALID_RESPONSE', `Overlay composition app ${index} has an invalid URL.`); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ProtocolError('INVALID_RESPONSE', `Overlay composition app ${index} must use an HTTP(S) URL.`);
    }
    if (url.username || url.password) {
      throw new ProtocolError('INVALID_RESPONSE', `Overlay composition app ${index} URL may not contain user information.`);
    }
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'http:' && !loopback) {
      throw new ProtocolError('INVALID_RESPONSE', `Overlay composition app ${index} must use HTTPS unless it targets localhost.`);
    }
    return { ...app, url: url.toString() };
  });
}

async function bootstrapBrowserSourceSession(baseUrl, connection, timeout = CONNECTION_TIMEOUT, signal) {
  const { response, body: result } = await fetchJsonWithTimeout(`${baseUrl}/stream/v1/compositor-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: connection.channel,
      secret: connection.secret,
      surface: connection.surface || 'streamOverlay'
    })
  }, timeout, signal);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PermissionRequiredError(result?.error || 'This browser source is not authorized.', result?.authorizeUrl);
    }
    throw compositorResponseError('Overlay session broker', response);
  }
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

async function fetchJsonWithTimeout(url, options, timeout, signal) {
  return fetchJson(url, options, timeout, signal, {
    invalidJson: error => new ProtocolError('INVALID_RESPONSE', 'The W3Booster API returned invalid JSON.', error),
    timeout: error => new ConnectionError('The W3Booster compositor request timed out.', [error])
  });
}

function createCompositionWatcher(authorizeWatch, listener, onError, externalSignal) {
  let socket;
  let pendingSocket;
  let reconnectTimer;
  let heartbeatTimer;
  const reconnectBackoff = createReconnectBackoff({ initialDelay: 250, maxDelay: 5000 });
  let stopped = false;
  const controller = new AbortController();
  const reportError = error => {
    if (!onError) {
      reportUnhandledError(error);
      return;
    }
    try {
      const result = onError(error);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(reportUnhandledError);
    } catch (handlerError) {
      reportUnhandledError(handlerError);
    }
  };
  const notify = message => {
    try {
      const result = listener(message);
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(reportError);
    } catch (error) {
      reportError(error);
    }
  };

  const watcher = {
    close() {
      if (stopped && controller.signal.aborted) return;
      stopped = true;
      externalSignal?.removeEventListener('abort', watcher.close);
      controller.abort();
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
      pendingSocket?.close();
      socket?.close();
      pendingSocket = null;
      socket = null;
    }
  };
  if (externalSignal?.aborted) watcher.close();
  else externalSignal?.addEventListener('abort', watcher.close, { once: true });

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = reconnectBackoff.nextDelay();
    if (delay === null) return;
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
      if (stopped || (error instanceof Error && error.name === 'AbortError')) {
        if (initial) throw error;
        return watcher;
      }
      if (initial) {
        stopped = true;
        externalSignal?.removeEventListener('abort', watcher.close);
        controller.abort();
        pendingSocket?.close();
        throw error;
      }
      reportError(error);
      if (!isRetryableConnectionError(error)) {
        watcher.close();
        return watcher;
      }
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
        reconnectBackoff.reset();
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
          if (message?.type === 'composition.ready' || message?.type === 'composition.changed') {
            if (message.surface !== undefined && message.surface !== 'streamOverlay' && message.surface !== 'ingameOverlay') {
              throw new ProtocolError('INVALID_MESSAGE', 'Overlay composition events contain an invalid surface.');
            }
            notify({ type: message.type, ...(message.surface ? { surface: message.surface } : {}) });
          }
        } catch (error) {
          reportError(error);
        }
      });
      candidate.addEventListener('error', () => {
        const error = new ConnectionError('Overlay composition watch failed.');
        if (!opened) {
          settle(reject, error);
          candidate.close();
        }
        else reportError(error);
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

function compositorResponseError(action, response) {
  const status = Number(response?.status);
  const retryable = status === 408 || status === 429 || status >= 500;
  return new ConnectionError(
    `${action} returned ${status}`,
    [],
    retryable ? 'UNAVAILABLE' : 'CONFIGURATION',
    status
  );
}

function compositorFailure(message, errors) {
  const last = errors.at(-1);
  if (last instanceof PermissionRequiredError || last instanceof ProtocolError ||
      (last instanceof ConnectionError && last.code === 'CONFIGURATION')) return last;
  return new ConnectionError(message, errors);
}

function reportUnhandledError(error) {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else globalThis.console?.error?.('W3Booster compositor listener failed:', error);
}
