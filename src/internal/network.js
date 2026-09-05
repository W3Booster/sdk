export const DEFAULT_LOCAL_API = 'https://localhost:25080';
export const DEFAULT_CLOUD_API = 'https://api.w3booster.com';
export const CONNECTION_TIMEOUT = 5000;

export function backendUrls(options = {}) {
  const backend = launchBackendHint() || options.backendUrl || options.backend || 'cloud';
  if ('localApi' in options || 'cloudApi' in options) throw new TypeError('Use backend and backendUrl to select the platform API.');
  const local = DEFAULT_LOCAL_API;
  const cloud = DEFAULT_CLOUD_API;
  if (backend === 'local') return [local];
  if (backend === 'cloud') return [cloud];
  if (backend !== 'auto') return [normalizeApiBase(backend, 'backend')];
  return [local, cloud];
}

export function normalizeApiBase(value, optionName) {
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

export async function fetchJsonWithTimeout(url, options, timeout, signal, errors) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let body = {};
    try { body = await response.json(); }
    catch (error) {
      if (response.ok) throw errors.invalidJson(error);
    }
    return { response, body };
  } catch (error) {
    if (timedOut && !signal?.aborted && error instanceof Error && error.name === 'AbortError') throw errors.timeout(error);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function validateAbortSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw new TypeError('signal must be an AbortSignal');
  }
}

export function createAbortError(message = 'W3Booster connection was cancelled.') {
  if (typeof globalThis.DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

export function abortable(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function launchBackendHint() {
  try {
    const backend = new URLSearchParams(globalThis.location?.search || '').get('backend');
    return backend === 'local' || backend === 'cloud' ? backend : null;
  } catch (_) {
    return null;
  }
}
