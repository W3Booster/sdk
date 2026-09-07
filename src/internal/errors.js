export class PermissionRequiredError extends Error {
  constructor(message, authorizeUrl) {
    super(message);
    this.name = 'PermissionRequiredError';
    /** @type {'PERMISSION_REQUIRED'} */
    this.code = 'PERMISSION_REQUIRED';
    this.authorizeUrl = safeAuthorizeUrl(authorizeUrl);
  }
}

export class ConnectionError extends Error {
  /**
   * @param {string} message
   * @param {readonly unknown[]} [causes]
   * @param {import('../../api-source/contracts.js').ConnectionErrorCode} [code]
   * @param {number} [status]
   */
  constructor(message, causes = [], code = 'UNAVAILABLE', status) {
    super(message);
    this.name = 'ConnectionError';
    this.causes = Object.freeze([...causes]);
    this.code = code;
    this.status = status;
  }
}

/** A failure at the fetch boundary, where TypeError means a network failure. */
export class NetworkRequestError extends ConnectionError {
  constructor(cause) {
    super('The W3Booster network request failed.', [cause]);
  }
}

export class HostActionError extends Error {
  constructor(message, code = 'HOST_ACTION_FAILED') {
    super(message);
    this.name = 'HostActionError';
    this.code = code;
  }
}

export class ProtocolError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {unknown} error
 * @returns {error is import('../../api-source/contracts.js').AbortError}
 */
export function isAbortError(error) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/**
 * @param {unknown} error
 * @returns {error is import('../../api-source/contracts.js').PermissionRequiredError |
 *   import('../../api-source/contracts.js').ConnectionError |
 *   import('../../api-source/contracts.js').ProtocolError |
 *   import('../../api-source/contracts.js').HostActionError}
 */
export function isW3BoosterError(error) {
  return error instanceof PermissionRequiredError || error instanceof ConnectionError ||
    error instanceof ProtocolError || error instanceof HostActionError;
}

export function isRetryableConnectionError(error) {
  return isRetryableCause(error, new Set());
}

function isRetryableCause(error, seen) {
  if (error instanceof NetworkRequestError) return true;
  if (error instanceof PermissionRequiredError || error instanceof ProtocolError || error instanceof TypeError) return false;
  if (!(error instanceof ConnectionError)) return true;
  if (error.code === 'CONFIGURATION' || error.code === 'APPLICATION_DEFINITION_MISMATCH' ||
      error.code === 'MISSING_BROWSER_API') return false;
  if (seen.has(error)) return false;
  seen.add(error);
  const causes = error.causes || [];
  return !causes.length || causes.some(cause => isRetryableCause(cause, seen));
}

/**
 * Return one stable discriminated classification for frontend error handling.
 * @param {unknown} error
 * @returns {import('../../api-source/contracts.js').W3BoosterErrorInfo}
 */
export function classifyW3BoosterError(error) {
  if (isAbortError(error)) return Object.freeze({ kind: 'abort', code: 'ABORTED', error });
  if (error instanceof PermissionRequiredError) {
    return Object.freeze({
      kind: 'permission',
      code: error.code,
      error,
      ...(error.authorizeUrl ? { authorizeUrl: error.authorizeUrl } : {})
    });
  }
  if (error instanceof ConnectionError) {
    return Object.freeze({
      kind: 'connection',
      code: error.code,
      error,
      ...(error.status === undefined ? {} : { status: error.status })
    });
  }
  if (error instanceof ProtocolError) return Object.freeze({ kind: 'protocol', code: error.code, error });
  if (error instanceof HostActionError) return Object.freeze({ kind: 'host-action', code: error.code, error });
  return Object.freeze({ kind: 'unknown', code: 'UNKNOWN', error });
}

function safeAuthorizeUrl(value) {
  if (typeof value !== 'string' || !value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) return undefined;
    return url.toString();
  } catch (_) {
    return undefined;
  }
}
