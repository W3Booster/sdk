import { SDK_VERSION } from '../version.js';
import {
  ConnectionError,
  isRetryableConnectionError,
  PermissionRequiredError,
  ProtocolError
} from './errors.js';
import {
  abortable,
  CONNECTION_TIMEOUT,
  createAbortError,
  fetchJsonWithTimeout,
  throwIfAborted
} from './network.js';
import { supportsProtocolVersion } from './protocol.js';
import { createReconnectBackoff, validateWebSocketUrl } from './websocket.js';

/** Broker-backed state transport, isolated from client state projection. */
export function createBrokerTransport(name, baseUrl, credentialProvider, reconnectPolicy) {
  let socket;
  let pendingSocket;
  let context;
  let lifecycleController;
  let reconnectTimer;
  let resyncTimer;
  let nextResyncAt = 0;
  const reconnectBackoff = reconnectPolicy ? createReconnectBackoff(reconnectPolicy) : null;
  let stopped = false;

  async function openSocket() {
    const signal = lifecycleController?.signal;
    throwIfAborted(signal);
    const credential = await abortable(Promise.resolve().then(credentialProvider), signal);
    const { response, body: ticket } = await fetchJsonWithTimeout(`${baseUrl}/stream/v1/stream-tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(credential ? { Authorization: `Bearer ${credential}` } : {})
      },
      body: JSON.stringify({
        clientId: context.clientId,
        scopes: context.scopes,
        protocolVersions: [...context.protocolVersions],
        sdkVersion: SDK_VERSION,
        ...(context.applicationRevision ? { applicationRevision: context.applicationRevision } : {})
      })
    }, CONNECTION_TIMEOUT, signal, {
      invalidJson: error => new ProtocolError('INVALID_TICKET', 'The stream broker returned invalid JSON.', error),
      timeout: error => new ConnectionError('The W3Booster broker request timed out.', [error], 'BROKER_TIMEOUT')
    });

    if (response.status === 401 || response.status === 403) {
      throw new PermissionRequiredError('This app has not been authorized.', ticket?.authorizeUrl);
    }
    if (!response.ok) {
      if (response.status === 409 && ticket?.code === 'APPLICATION_DEFINITION_MISMATCH') {
        throw new ConnectionError(
          ticket.error || 'The generated application definition is outdated.',
          [],
          'APPLICATION_DEFINITION_MISMATCH',
          response.status
        );
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new ConnectionError(
        `${name} broker returned ${response.status}`,
        [],
        retryable ? 'UNAVAILABLE' : 'CONFIGURATION',
        response.status
      );
    }
    const negotiatedVersion = ticket?.protocolVersion;
    if (!supportsProtocolVersion(negotiatedVersion)) {
      throw new ProtocolError('UNSUPPORTED_PROTOCOL', `The server selected unsupported protocol ${negotiatedVersion}.`, { negotiatedVersion });
    }
    if (context.applicationRevision && ticket?.applicationRevision !== context.applicationRevision) {
      throw new ConnectionError(
        'The stream broker did not confirm the generated application definition revision.',
        [],
        'APPLICATION_DEFINITION_MISMATCH',
        response.status
      );
    }
    const websocketUrl = validateWebSocketUrl(ticket?.websocketUrl);
    throwIfAborted(signal);
    if (stopped) throw createAbortError();
    await new Promise((resolve, reject) => {
      const candidate = new WebSocket(websocketUrl);
      pendingSocket = candidate;
      let opened = false;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (pendingSocket === candidate) pendingSocket = null;
        callback(value);
      };
      const abort = () => {
        finish(reject, createAbortError());
        candidate.close();
      };
      const timer = setTimeout(() => {
        finish(reject, new ConnectionError(`${name} WebSocket did not open in time.`));
        candidate.close();
      }, CONNECTION_TIMEOUT);
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      candidate.addEventListener('open', () => {
        if (stopped || signal?.aborted) return abort();
        opened = true;
        socket = candidate;
        nextResyncAt = 0;
        finish(resolve);
      }, { once: true });
      candidate.addEventListener('error', () => {
        const error = new Error(`${name} WebSocket failed`);
        if (!opened) finish(reject, error);
        else context.onError(error);
      });
      candidate.addEventListener('message', event => {
        if (socket === candidate) context.onMessage(event.data);
      });
      candidate.addEventListener('close', () => {
        if (socket === candidate) {
          socket = null;
          clearTimeout(resyncTimer);
          resyncTimer = null;
        }
        if (!opened) finish(reject, new Error(`${name} WebSocket closed before connecting`));
        else if (!stopped) scheduleReconnect();
      });
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    if (!reconnectBackoff?.canRetry) {
      context.onError(new ConnectionError(`${name} WebSocket disconnected and will not reconnect.`, [], 'UNAVAILABLE'));
      context.onStatus('error');
      return;
    }
    context.onStatus('reconnecting');
    const delay = reconnectBackoff.nextDelay();
    if (delay === null) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await openSocket();
        reconnectBackoff.reset();
        context.onStatus('connected');
      } catch (error) {
        context.onError(error);
        if (!isRetryableConnectionError(error)) {
          context.onStatus('error');
          return;
        }
        scheduleReconnect();
      }
    }, delay);
  }

  return {
    name,
    async open(nextContext) {
      context = nextContext;
      stopped = false;
      lifecycleController = new AbortController();
      const abort = () => lifecycleController?.abort(context.signal?.reason);
      if (context.signal?.aborted) abort();
      else context.signal?.addEventListener('abort', abort, { once: true });
      try { await openSocket(); }
      finally { context.signal?.removeEventListener('abort', abort); }
    },
    resync() {
      if (stopped || socket?.readyState !== WebSocket.OPEN || resyncTimer) return;
      const send = () => {
        resyncTimer = null;
        if (stopped || socket?.readyState !== WebSocket.OPEN) return;
        nextResyncAt = Date.now() + 1000;
        socket.send(JSON.stringify({ type: 'stream.resync' }));
      };
      const delay = nextResyncAt - Date.now();
      if (delay > 0) resyncTimer = setTimeout(send, delay);
      else send();
    },
    close() {
      stopped = true;
      lifecycleController?.abort(createAbortError());
      lifecycleController = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearTimeout(resyncTimer);
      resyncTimer = null;
      pendingSocket?.close();
      pendingSocket = null;
      socket?.close();
      socket = null;
    }
  };
}

export function createCredentialProvider(options) {
  if (options.tokenProvider) return () => options.tokenProvider();
  let resolved = false;
  let credential = null;
  return async () => {
    if (resolved) return credential;
    credential = readLaunchCredential(options.clientId);
    resolved = true;
    return credential;
  };
}

function readLaunchCredential(clientId) {
  if (!globalThis.location) return null;
  const hash = new URLSearchParams(globalThis.location.hash.replace(/^#/, ''));
  const session = hash.get('w3session');
  if (session) {
    hash.delete('w3session');
    const remainingHash = hash.toString();
    try {
      globalThis.history?.replaceState(
        globalThis.history?.state ?? null,
        '',
        `${location.pathname}${location.search}${remainingHash ? `#${remainingHash}` : ''}`
      );
    } catch (_) { /* Credential use must not depend on address-bar cleanup. */ }
    try { globalThis.sessionStorage?.setItem(`w3booster.session.${clientId}`, session); } catch (_) { }
    return session;
  }
  try { return globalThis.sessionStorage?.getItem(`w3booster.session.${clientId}`) || null; } catch (_) { return null; }
}
