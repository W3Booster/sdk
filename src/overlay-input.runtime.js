const CHANNEL = 'w3-overlay-input-v1';
const registrations = new WeakMap();

/** @param {import('../api-source/overlay-input-contracts.js').OverlayInputOptions} [options] */
export function initializeOverlayInput(options = {}) {
  const win = globalThis.window;
  if (!win || win.parent === win || options.signal?.aborted) return { refresh() {}, close() {} };
  if (registrations.has(win)) return registrations.get(win);
  const doc = win.document;
  let origin = '', token = '', closed = false, dirty = true, raf = 0, revision = 0, sequence = 0;
  let elements = [], regions = [], signature = '', lastSent = 0;
  const ids = new WeakMap();
  const gestures = new Map();
  const listeners = [];
  const timers = new Set();
  const send = payload => {
    if (!closed && token) win.parent.postMessage({ channel: CHANNEL, token, ...payload }, origin);
  };
  const listen = (type, fn, capture = false) => { win.addEventListener(type, fn, capture); listeners.push([type, fn, capture]); };
  const later = fn => { const id = setTimeout(() => { timers.delete(id); if (!closed) fn(); }, 0); timers.add(id); };
  function refresh() {
    if (!token || closed) return;
    if (dirty) { elements = Array.from(doc.querySelectorAll('.w3-interactive')).slice(0, 256); dirty = false; }
    regions = [];
    for (const element of elements) {
      if (!element.isConnected || element.closest('[data-w3-input="disabled"], [inert]')) continue;
      const style = win.getComputedStyle(element);
      if (style.visibility !== 'visible' || style.pointerEvents === 'none' || !element.getClientRects().length) continue;
      const box = element.getBoundingClientRect();
      let left = Math.max(0, box.left), top = Math.max(0, box.top);
      let right = Math.min(win.innerWidth, box.right), bottom = Math.min(win.innerHeight, box.bottom);
      for (let parent = element.parentElement; parent && right > left && bottom > top; parent = parent.parentElement) {
        const css = win.getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if (css.overflowX !== 'visible') { left = Math.max(left, clip.left + parent.clientLeft); right = Math.min(right, clip.left + parent.clientLeft + parent.clientWidth); }
        if (css.overflowY !== 'visible') { top = Math.max(top, clip.top + parent.clientTop); bottom = Math.min(bottom, clip.top + parent.clientTop + parent.clientHeight); }
      }
      if (!(right > left && bottom > top)) continue;
      if (!ids.has(element)) ids.set(element, String(++sequence));
      regions.push({ id: ids.get(element), x: left, y: top, width: right - left, height: bottom - top,
        mode: element.getAttribute('data-w3-input') === 'conditional' ? 'conditional' : 'block' });
    }
    const next = JSON.stringify([win.innerWidth, win.innerHeight, regions]);
    if (next !== signature || Date.now() - lastSent >= 200) {
      signature = next; lastSent = Date.now();
      send({ type: 'regions', revision: ++revision, width: win.innerWidth, height: win.innerHeight, regions });
    }
    for (const [pointer, gesture] of gestures) {
      if (!regions.some(r => r.id === gesture.region)) { send({ type: 'cancel', sequence: gesture.sequence }); gestures.delete(pointer); }
    }
  }
  function tick() { refresh(); raf = win.requestAnimationFrame(tick); }
  function message(event) {
    if (event.source !== win.parent || (options.parentOrigin && event.origin !== options.parentOrigin)) return;
    const value = event.data;
    if (value?.channel !== CHANNEL || value.type !== 'hello' || value.surface !== 'ingameOverlay' || typeof value.token !== 'string') return;
    if (token !== value.token) { gestures.clear(); signature = ''; revision = 0; dirty = true; }
    origin = event.origin; token = value.token; refresh();
    if (!raf) raf = win.requestAnimationFrame(tick);
  }
  function regionFor(event) {
    const element = event.composedPath().find(node => node instanceof win.Element && node.matches('.w3-interactive'));
    return element && regions.find(r => r.id === ids.get(element));
  }
  function observeConsumption(event) {
    let stopped = false;
    // Wrap this event, not Event.prototype. A later task sees all synchronous
    // handlers, including stopImmediatePropagation on the same root node.
    for (const method of ['stopPropagation', 'stopImmediatePropagation']) {
      const original = event[method];
      try { event[method] = function (...args) { stopped = true; return original.apply(this, args); }; }
      catch (_) { stopped = true; }
    }
    return () => stopped || event.defaultPrevented;
  }
  function point(event) { return { x: event.clientX, y: event.clientY, button: event.button,
    occurredAt: Date.now() - Math.max(0, win.performance.now() - event.timeStamp),
    shift: event.shiftKey, ctrl: event.ctrlKey }; }
  function down(event) {
    if (!event.isTrusted || !token || event.pointerType !== 'mouse' || event.button < 0 || event.button > 2) return;
    const region = regionFor(event);
    if (!region) return;
    const gesture = { sequence: ++sequence, region: region.id, button: event.button,
      checks: /** @type {Array<() => boolean>} */ ([]) };
    gestures.set(event.pointerId, gesture);
    gesture.checks.push(observeConsumption(event));
    const position = point(event), identity = { sequence: gesture.sequence, region: gesture.region };
    send({ type: 'pending', ...identity, ...position });
    later(() => send({ type: 'down', ...identity, ...position, consumed: region.mode === 'block' || gesture.checks.some(check => check()) }));
  }
  function up(event) {
    if (!event.isTrusted) return;
    const gesture = gestures.get(event.pointerId);
    if (!gesture) return;
    gestures.delete(event.pointerId);
    const position = point(event);
    later(() => send({ type: 'up', sequence: gesture.sequence, region: gesture.region, ...position }));
    dirty = true;
  }
  function cancel(event) {
    if (!event.isTrusted) return;
    const gesture = gestures.get(event.pointerId);
    if (gesture) send({ type: 'cancel', sequence: gesture.sequence });
    gestures.delete(event.pointerId);
  }
  function wheel(event) {
    if (!event.isTrusted) return;
    const region = regionFor(event);
    if (!region) return;
    const consumed = observeConsumption(event), position = point(event);
    later(() => send({ type: 'wheel', ...position, region: region.id, consumed: region.mode === 'block' || consumed(),
      deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode }));
  }
  const observer = new win.MutationObserver(() => { dirty = true; });
  observer.observe(doc, { subtree: true, childList: true, attributes: true });
  listen('message', message);
  listen('pointerdown', down, true); listen('pointerup', up, true);
  listen('mousedown', event => {
    if (!event.isTrusted) return;
    const gesture = [...gestures.values()].find(g => g.button === event.button);
    if (gesture) gesture.checks.push(observeConsumption(event));
  }, true);
  listen('pointercancel', cancel, true); listen('wheel', wheel, true);
  const heartbeat = setInterval(refresh, 200);
  const registration = { refresh() { dirty = true; refresh(); }, close() {
    if (closed) return;
    send({ type: 'regions', revision: ++revision, width: win.innerWidth, height: win.innerHeight, regions: [] });
    for (const gesture of gestures.values()) send({ type: 'cancel', sequence: gesture.sequence });
    closed = true; observer.disconnect(); clearInterval(heartbeat); win.cancelAnimationFrame(raf);
    for (const id of timers) clearTimeout(id);
    for (const [type, fn, capture] of listeners) win.removeEventListener(type, fn, capture);
    options.signal?.removeEventListener('abort', registration.close); registrations.delete(win);
  } };
  options.signal?.addEventListener('abort', registration.close, { once: true });
  registrations.set(win, registration);
  return registration;
}
