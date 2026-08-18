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
      let initial = true;
      return source.subscribe(() => {
        if (initial) {
          initial = false;
          return;
        }
        listener();
      });
    }
  });
}

/** Adapt a stable selector over an SDK store without adding React as a dependency. */
export function createReactSelectorStore(source, selector, options = {}) {
  validateSource(source);
  if (typeof selector !== 'function') throw new TypeError('selector must be a function');
  const equals = options.equals ?? Object.is;
  if (typeof equals !== 'function') throw new TypeError('equals must be a function');
  const readServerSource = serverSnapshotReader(source, options);
  const serverValue = selector(readServerSource());
  let value = selector(source.get());
  const listeners = new Set();
  let unsubscribeSource = null;

  const read = () => {
    const next = selector(source.get());
    if (!equals(value, next)) value = next;
    return value;
  };
  return Object.freeze({
    getSnapshot: read,
    getServerSnapshot: () => serverValue,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      if (!unsubscribeSource) {
        let initial = true;
        unsubscribeSource = source.subscribe(snapshot => {
          const next = selector(snapshot);
          if (initial) {
            initial = false;
            value = next;
            return;
          }
          if (equals(value, next)) return;
          value = next;
          let listenerError;
          for (const subscriber of [...listeners]) {
            try { subscriber(); }
            catch (error) { listenerError ??= error; }
          }
          if (listenerError) throw listenerError;
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !unsubscribeSource) return;
        unsubscribeSource();
        unsubscribeSource = null;
      };
    }
  });
}
