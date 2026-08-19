import { createAbortError, isPlainObject, validateAbortSignal } from './network.js';

export function normalizeStartupOptions(options) {
  if (!isPlainObject(options)) throw new TypeError('start options must be an object');
  validateAbortSignal(options.signal);
  const until = options.until ?? 'synchronized';
  if (!['connected', 'ready', 'synchronized'].includes(until)) {
    throw new TypeError('start.until must be connected, ready, or synchronized');
  }
  const timeout = options.timeout === undefined ? 0 : Number(options.timeout);
  if (!Number.isFinite(timeout) || timeout < 0) throw new TypeError('start.timeout must be a non-negative number');
  if (options.signal?.aborted) throw createAbortError('W3Booster startup was cancelled.');
  return { until, timeout, signal: options.signal };
}

export async function waitForStartupState(client, lifecycle, until, timeout, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let unsubscribe = () => {};
  const terminalFailure = new Promise((_, reject) => {
    unsubscribe = lifecycle.subscribe(snapshot => {
      let error;
      if (snapshot.status === 'error') {
        error = snapshot.error ?? new Error('W3Booster startup failed before state was ready.');
      } else if (snapshot.status === 'closed') {
        error = createAbortError('W3Booster stopped before frontend state was ready.');
      } else return;
      reject(error);
      controller.abort(error);
    });
  });
  const readiness = until === 'ready'
    ? client.whenReady({ timeout, signal: controller.signal })
    : client.whenSynchronized({ timeout, signal: controller.signal });
  try {
    await Promise.race([readiness, terminalFailure]);
  } finally {
    unsubscribe();
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
}
