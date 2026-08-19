import { createMemoizedSelector } from '../store.js';

const deeplyFrozen = new WeakSet();

/** Memoize SDK-owned immutable identities, while always recomputing ordinary mutable consumer values. */
export function createImmutableSelector(selector) {
  const memoized = createMemoizedSelector(selector);
  return (...args) => isDeeplyFrozen(args[0]) ? memoized(...args) : selector(...args);
}

function isDeeplyFrozen(value, visiting = new Set()) {
  if (!value || typeof value !== 'object') return true;
  if (deeplyFrozen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  if (visiting.has(value)) return true;
  visiting.add(value);
  const frozen = Reflect.ownKeys(value).every(key => isDeeplyFrozen(value[key], visiting));
  visiting.delete(value);
  if (frozen) deeplyFrozen.add(value);
  return frozen;
}
