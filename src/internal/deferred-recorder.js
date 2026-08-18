/** Load the optional local recorder only after an eligible platform snapshot advertises it. */
export class DeferredLocalRecorderTransport {
  constructor({ enabled, onUpdates, onStatus, onError }) {
    this.enabled = enabled;
    this.options = { enabled, onUpdates, onStatus, onError };
    this.onError = onError;
    this.transport = null;
    this.module = null;
    this.pending = null;
    this.state = null;
    this.generation = 0;
  }

  configure(state) {
    this.state = state;
    if (!this.enabled || !isEligible(state)) {
      this.transport?.configure(state);
      return;
    }
    if (this.transport) {
      this.transport.configure(state);
      return;
    }
    if (this.pending) return;
    const generation = this.generation;
    const pending = import('./recorder.js').then(module => {
      if (generation !== this.generation) return;
      this.module = module;
      this.transport = new module.LocalRecorderTransport(this.options);
      this.transport.configure(this.state);
    }).catch(error => {
      if (generation === this.generation) this.onError(error);
    }).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
  }

  applyTo(state) {
    return this.transport?.applyTo(state) ?? state;
  }

  applyUpdates(state, updates) {
    return this.module?.applyLocalRecorderUpdates(state, updates) ?? state;
  }

  close() {
    this.generation += 1;
    this.state = null;
    this.transport?.close();
    this.transport = null;
    this.module = null;
    this.pending = null;
  }
}

function isEligible(state) {
  const match = state?.match;
  const active = match?.status === 'starting' || match?.status === 'running';
  const observerOrReplay = match?.isObserver === true || match?.isReplay === true;
  return active && observerOrReplay && Array.isArray(state?.overlay?.misc?.localServerUrls) &&
    state.overlay.misc.localServerUrls.length > 0;
}
