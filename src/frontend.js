/** Adapt an immediately-publishing SDK store to React's useSyncExternalStore contract. */
export function createExternalStore(source) {
  if (!source || typeof source.get !== 'function' || typeof source.subscribe !== 'function') {
    throw new TypeError('source must provide get() and subscribe()');
  }
  return Object.freeze({
    getSnapshot: () => source.get(),
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

/** Adapt a stable selector over an SDK store without introducing a framework dependency. */
export function createSelectorExternalStore(source, selector, equals = Object.is) {
  if (!source || typeof source.get !== 'function' || typeof source.subscribe !== 'function') {
    throw new TypeError('source must provide get() and subscribe()');
  }
  if (typeof selector !== 'function') throw new TypeError('selector must be a function');
  if (typeof equals !== 'function') throw new TypeError('equals must be a function');
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
