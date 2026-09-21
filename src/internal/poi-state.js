import { isPlainObject } from './network.js';
import { validTimedProgress, validPool, isTypeId, isInstanceId } from './unit-state.js';

const KINDS = new Set(['goblin-merchant', 'marketplace', 'mercenary-camp', 'goblin-laboratory',
  'tavern', 'fountain', 'gold-mine', 'way-gate', 'dragon-roost', 'goblin-shipyard', 'creep-camp']);
const REASONS = new Set(['gold', 'lumber', 'food', 'prerequisite', 'hero-limit', 'range', 'stock', 'cooldown', 'unavailable']);
const number = value => Number.isFinite(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const point = value => isPlainObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
// Validate known fields below; additional JSON fields are forward-compatible.
const optional = (value, key, valid) => value[key] === undefined || valid(value[key]);
const timer = value => isPlainObject(value) && validTimedProgress(value);

export function validPoiOffer(value) {
  return isPlainObject(value) &&
    identity(value.id) && ['item', 'unit', 'hero', 'service'].includes(value.kind) && isTypeId(value.typeId) &&
    optional(value, 'cost', cost => isPlainObject(cost) && number(cost.gold) && number(cost.lumber) && optional(cost, 'food', number)) &&
    optional(value, 'stock', stock => isPlainObject(stock) && integer(stock.current) && optional(stock, 'max', max => integer(max) && stock.current <= max)) &&
    ['initialAvailability', 'restock', 'cooldown'].every(key => optional(value, key, timer)) &&
    optional(value, 'stockPoolId', identity) && optional(value, 'eligibility', entries => isPlainObject(entries) &&
      Object.entries(entries).every(([key, entry]) => identity(key) && isPlainObject(entry) &&
        typeof entry.available === 'boolean' && Array.isArray(entry.reasons) && entry.reasons.every(reason => REASONS.has(reason))));
}

export function validPointOfInterest(value) {
  if (!isPlainObject(value) ||
    !identity(value.id) || !KINDS.has(value.kind) || !point(value.position) || !number(value.observedAtGameTime) ||
    !optional(value, 'typeId', isTypeId) || !optional(value, 'ownerSlot', slot => integer(slot) && slot < 28) || !optional(value, 'guardCampId', identity) ||
    !optional(value, 'nextStockUpdate', timer)) return false;
  if (value.offers !== undefined && (!Array.isArray(value.offers) || value.offers.length > 256 ||
    !value.offers.every(validPoiOffer) || new Set(value.offers.map(offer => offer.id)).size !== value.offers.length)) return false;
  if (value.fountain !== undefined) {
    const f = value.fountain;
    if (value.kind !== 'fountain' || !isPlainObject(f) ||
      !Array.isArray(f.restores) || !f.restores.length || new Set(f.restores).size !== f.restores.length ||
      !f.restores.every(pool => ['health', 'mana'].includes(pool)) || !optional(f, 'active', active => typeof active === 'boolean') ||
      !['radius', 'healthPerSecond', 'manaPerSecond', 'healthFractionPerSecond', 'manaFractionPerSecond'].every(key => optional(f, key, number))) return false;
  }
  if (value.mine !== undefined) {
    const mine = value.mine;
    if (value.kind !== 'gold-mine' || !isPlainObject(mine) ||
      !optional(mine, 'remainingGold', integer) || !optional(mine, 'initialGold', integer) ||
      !optional(mine, 'ownerPlayerId', owner => owner === null || identity(owner)) || !optional(mine, 'buildingId', isInstanceId)) return false;
  }
  if (value.wayGate !== undefined) {
    const gate = value.wayGate;
    if (value.kind !== 'way-gate' || !isPlainObject(gate) ||
      !optional(gate, 'enabled', enabled => typeof enabled === 'boolean') || !optional(gate, 'destination', point) ||
      !optional(gate, 'destinationPoiId', identity)) return false;
  }
  if (value.camp !== undefined) {
    const camp = value.camp;
    if (value.kind !== 'creep-camp' || !isPlainObject(camp) ||
      !['alive', 'partially-cleared', 'cleared', 'unknown'].includes(camp.state) || !Array.isArray(camp.members) || camp.members.length > 8192 ||
      !camp.members.every(member => isPlainObject(member) && isInstanceId(member.id) && isTypeId(member.typeId) &&
        optional(member, 'alive', alive => typeof alive === 'boolean') && optional(member, 'position', point) && optional(member, 'hitpoints', validPool)) ||
      new Set(camp.members.map(member => member.id)).size !== camp.members.length) return false;
    if (camp.dropTable !== undefined && (!Array.isArray(camp.dropTable) || camp.dropTable.length > 256 || !camp.dropTable.every(drop =>
      isPlainObject(drop) && (drop.typeId !== undefined || drop.itemClass !== undefined) &&
      optional(drop, 'typeId', isTypeId) && optional(drop, 'itemClass', identity) && optional(drop, 'level', integer) &&
      optional(drop, 'probability', probability => number(probability) && probability <= 1)))) return false;
  }
  return true;
}

/** Complete collection replacement: a replay seek or failed read must not retain stale fields. */
export function validPoiCollection(value) {
  return isPlainObject(value) && Object.keys(value).length <= 8192 &&
    Object.entries(value).every(([id, poi]) => validPointOfInterest(poi) && poi.id === id);
}

/** Frozen game-start state, including initial inventories. Never refresh or animate it. */
export function validInitialPoiCollection(value) {
  return validPoiCollection(value) && Object.values(value).every(poi => poi.observedAtGameTime === 0);
}
