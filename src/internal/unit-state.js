import { isPlainObject } from './network.js';
import { deepEqual } from './values.js';

export const UNIT_COLLECTIONS = ['units', 'heroes', 'buildings'];
export const isInstanceId = value => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
export const isTypeId = value => typeof value === 'string' && /^[A-Za-z0-9]{4}$/.test(value);
export const validPool = value => isPlainObject(value) && Number.isFinite(value.current) &&
  Number.isFinite(value.max) && value.max >= 0 && value.current >= 0 && value.current <= value.max;
export const validPosition = value => isPlainObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y) &&
  Math.abs(value.x) <= 1000000 && Math.abs(value.y) <= 1000000;
export const validProgress = value => value === null || Number.isFinite(value) && value >= 0 && value <= 1;
export const validQueue = value => Array.isArray(value) && value.length <= 16 && value.every((item, index) =>
  isPlainObject(item) && item.position === index && isTypeId(item.typeId) && validProgress(item.progress));
export function healthCollection(update) {
  return /^[A-Z]/.test(update.typeId) ? 'heroes' : update.targetFlags & 8 ? 'buildings' : 'units';
}
export function validUnitUpdate(update) {
  if (!isInstanceId(update.id) || !isTypeId(update.typeId) || !Number.isInteger(update.slotId) || update.slotId < 0 || update.slotId >= 24) return false;
  if (update.removed === true) return true;
  if (update.class === 'W3UnitHealth') return Number.isInteger(update.targetFlags) && update.targetFlags > 0 &&
    update.targetFlags < 2048 && validPool(update.hitpoints) && update.hitpoints.max > 0 &&
    (update.construction === undefined || !/^[A-Z]/.test(update.typeId) && (update.targetFlags & 8) &&
      isPlainObject(update.construction) && validProgress(update.construction.progress)) &&
    (update.position === undefined || (/^[A-Z]/.test(update.typeId) || update.targetFlags & 8) && validPosition(update.position)) &&
    (update.mana === undefined || /^[A-Z]/.test(update.typeId) && validPool(update.mana));
  if (update.class === 'W3ProductionQueue') return validQueue(update.queue);
  return update.class === 'W3Unit' && update.isHero === true && /^[A-Z]/.test(update.typeId) &&
    Number.isFinite(update.experience) && update.experience >= 0;
}

/** Replace one observation while preserving unrelated fields and object identities. */
export function applyUnitObservation(player, update, capabilities) {
  const collection = update.class === 'W3UnitHealth' ? healthCollection(update) :
    update.class === 'W3Unit' ? 'heroes' : 'buildings';
  const id = update.id;
  const previous = player[collection]?.[id];
  const canRead = capabilities.includes(update.class === 'W3ProductionQueue' ? 'production' : collection);
  if (!canRead) return player;
  let unit = previous ? { ...previous } : { id, typeId: update.typeId };
  unit.typeId = update.typeId;
  if (update.class === 'W3ProductionQueue') {
    if (update.removed) delete unit.production;
    else unit.production = { queue: update.queue.map(item => ({ position: item.position, typeId: item.typeId, progress: item.progress })) };
  } else if (update.class === 'W3UnitHealth') {
    if (update.removed) { delete unit.hitpoints; delete unit.mana; delete unit.position; delete unit.construction; }
    else {
      if (update.construction !== undefined) unit.construction = { progress: update.construction.progress };
      else delete unit.construction;
      if (update.position !== undefined) unit.position = { x: update.position.x, y: update.position.y };
      else delete unit.position;
      unit.hitpoints = { current: update.hitpoints.current, max: update.hitpoints.max };
      if (update.mana !== undefined) unit.mana = { current: update.mana.current, max: update.mana.max };
      else delete unit.mana;
    }
  }
  // A changed pool/progress must not replace an unchanged position or queue.
  if (previous) for (const key of Object.keys(unit)) {
    if (deepEqual(previous[key], unit[key])) unit[key] = previous[key];
  }
  if (update.removed && (!previous || Object.keys(unit).every(key => key === 'id' || key === 'typeId'))) unit = undefined;
  if (deepEqual(previous, unit)) return player;
  const values = { ...(player[collection] || {}) };
  if (unit) values[id] = unit;
  else delete values[id];
  return { ...player, [collection]: values };
}
