import { createSelectorStore } from './store.js';

function validateSource(source) {
  if (!source || typeof source.get !== 'function' || typeof source.subscribe !== 'function') {
    throw new TypeError('source must provide get() and subscribe()');
  }
}

function serverSnapshotReader(source, options) {
  if (options?.getServerSnapshot !== undefined && typeof options.getServerSnapshot !== 'function') {
    throw new TypeError('getServerSnapshot must be a function');
  }
  return options?.getServerSnapshot ?? (() => source.get());
}

/** Adapt an immediately-publishing SDK store to React's useSyncExternalStore contract. */
export function createReactStore(source, options = {}) {
  validateSource(source);
  const serverSnapshot = serverSnapshotReader(source, options)();
  return Object.freeze({
    getSnapshot: () => source.get(),
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      const initialSnapshot = source.get();
      let subscribing = true;
      let receivedSynchronousInitial = false;
      const unsubscribe = source.subscribe(snapshot => {
        if (subscribing && !receivedSynchronousInitial && Object.is(snapshot, initialSnapshot)) {
          receivedSynchronousInitial = true;
          return;
        }
        if (subscribing) receivedSynchronousInitial = true;
        listener();
      });
      subscribing = false;
      return unsubscribe;
    }
  });
}

/** Adapt a stable selector over an SDK store without adding React as a dependency. */
export function createReactSelectorStore(source, selector, options = {}) {
  validateSource(source);
  if (typeof selector !== 'function') throw new TypeError('selector must be a function');
  const readServerSource = serverSnapshotReader(source, options);
  const selected = createSelectorStore(source, selector, { equals: options.equals, onError: options.onError });
  return createReactStore(selected, {
    getServerSnapshot: () => selector(readServerSource())
  });
}
