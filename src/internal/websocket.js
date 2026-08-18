import { ProtocolError } from './errors.js';

export function validateWebSocketUrl(value) {
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

/** Shared bounded exponential-backoff state for browser socket transports. */
export function createReconnectBackoff(options = {}) {
  const initialDelay = Number(options.initialDelay ?? 250);
  const maxDelay = Number(options.maxDelay ?? 5000);
  const maxAttempts = options.maxAttempts === undefined ? Infinity : Number(options.maxAttempts);
  let attempts = 0;
  return Object.freeze({
    get attempts() { return attempts; },
    get canRetry() { return attempts < maxAttempts; },
    nextDelay() {
      if (attempts >= maxAttempts) return null;
      const delay = Math.min(initialDelay * (2 ** attempts), maxDelay);
      attempts += 1;
      return delay;
    },
    reset() { attempts = 0; }
  });
}
