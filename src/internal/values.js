import { ProtocolError } from './errors.js';
import { isPlainObject } from './network.js';

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function assertSafeValue(value, path, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new ProtocolError('INVALID_MESSAGE', `Non-finite numbers are not allowed at ${path}.`);
  }
  if (typeof value !== 'object') {
    throw new ProtocolError('INVALID_MESSAGE', `Only JSON values are allowed at ${path}.`);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new ProtocolError('INVALID_MESSAGE', `Only plain JSON objects are allowed at ${path}.`);
  }
  if (seen.has(value)) throw new ProtocolError('INVALID_MESSAGE', `Circular data is not allowed at ${path}.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`, seen));
  else {
    for (const key of Object.keys(value)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) throw new ProtocolError('UNSAFE_MESSAGE', `Unsafe object key at ${path}.${key}.`);
      assertSafeValue(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function structuredCloneSafe(value) {
  if (value === undefined || value === null) return value;
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function deepFreeze(value) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    Object.values(item).forEach(child => pending.push(child));
    Object.freeze(item);
  }
  return value;
}

export function deepEqual(left, right, seen = new WeakMap()) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  let rightValues = seen.get(left);
  if (rightValues?.has(right)) return true;
  if (!rightValues) {
    rightValues = new WeakSet();
    seen.set(left, rightValues);
  }
  rightValues.add(right);

  if (Array.isArray(left)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index], seen));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key], seen));
}
