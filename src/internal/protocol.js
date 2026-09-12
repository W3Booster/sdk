import { UNIT_COLLECTIONS, isInstanceId, isTypeId, validPool, validTimedProgress, validQueue } from './unit-state.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '../version.js';
import { ProtocolError } from './errors.js';
import { isPlainObject } from './network.js';
import { assertSafeValue, deepEqual, structuredCloneSafe } from './values.js';

const MAX_MESSAGE_LENGTH = 5 * 1024 * 1024;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MATCH_STATUSES = new Set(['starting', 'running', 'finished', 'none']);
const RACES = new Set(['random', 'human', 'orc', 'undead', 'night-elf']);
const APP_SURFACES = new Set(['application', 'streamOverlay', 'ingameOverlay']);

export function parseProtocolMessage(rawMessage) {
  if (typeof rawMessage === 'string' && rawMessage.length > MAX_MESSAGE_LENGTH) {
    throw new ProtocolError('MESSAGE_TOO_LARGE', 'The W3Booster stream message exceeded the safety limit.');
  }
  let message;
  try { message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage; }
  catch (error) { throw new ProtocolError('INVALID_JSON', 'The W3Booster stream sent invalid JSON.', error); }
  if (!isPlainObject(message)) throw new ProtocolError('INVALID_ENVELOPE', 'The W3Booster stream message must be an object.');
  const version = message.version;
  if (!supportsProtocolVersion(version)) {
    throw new ProtocolError('UNSUPPORTED_PROTOCOL', `Unsupported W3Booster protocol ${String(version)}.`, { receivedVersion: version });
  }
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 1) {
    throw new ProtocolError('INVALID_SEQUENCE', 'The W3Booster stream sequence must be a positive integer.');
  }
  if (typeof message.type !== 'string' || !message.type || message.type.length > 100) {
    throw new ProtocolError('INVALID_TYPE', 'The W3Booster stream message type is invalid.');
  }
  assertSafeValue(message.data, 'data');
  return { ...message, version };
}

export function supportsProtocolVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+$/.test(version)) return false;
  const major = version.split('.')[0];
  return SUPPORTED_PROTOCOL_VERSIONS.some(supported => supported.split('.')[0] === major);
}

export function validateState(value, clientId, cloneState = true) {
  if (!isPlainObject(value)) throw new ProtocolError('INVALID_STATE', 'State must be an object.');
  assertSafeValue(value, 'state');
  const state = cloneState ? structuredCloneSafe(value) : value;
  if (cloneState) normalizeMatchMap(state);
  if (!Array.isArray(state.capabilities) || state.capabilities.some(item => typeof item !== 'string')) {
    throw new ProtocolError('INVALID_STATE', 'State capabilities must be an array of strings.');
  }
  if (!isPlainObject(state.match)) throw new ProtocolError('INVALID_STATE', 'State match is missing.');
  if (typeof state.match.id !== 'string' || typeof state.match.status !== 'string' ||
      !Number.isSafeInteger(state.match.gameTime) || state.match.gameTime < 0 || typeof state.match.mode !== 'string') {
    throw new ProtocolError('INVALID_STATE', 'State match contains invalid core fields.');
  }
  if (!MATCH_STATUSES.has(state.match.status)) throw new ProtocolError('INVALID_STATE', `Unknown match status: ${state.match.status}`);
  if (state.match.status !== 'none' && !state.match.id.trim()) {
    throw new ProtocolError('INVALID_STATE', 'An active or completed match must have a non-empty ID.');
  }
  validateOptionalFields(state.match, {
    gameDataId: 'string', gameVersion: 'string', map: 'string', realm: 'string', paused: 'boolean', isReplay: 'boolean', isReforged: 'boolean', isObserver: 'boolean',
    broadcasterPlayerId: 'string', realBroadcasterPlayerId: 'string', startedAt: 'string', endedAt: 'string'
  }, 'State match');
  if (state.match.startedAt !== undefined && !isIsoTimestamp(state.match.startedAt)) {
    throw new ProtocolError('INVALID_STATE', 'State match startedAt must be an ISO-8601 timestamp.');
  }
  if (state.match.endedAt !== undefined && !isIsoTimestamp(state.match.endedAt)) {
    throw new ProtocolError('INVALID_STATE', 'State match endedAt must be an ISO-8601 timestamp.');
  }
  if (state.match.result !== undefined && (!isPlainObject(state.match.result) ||
      typeof state.match.result.playerId !== 'string' || !state.match.result.playerId.trim() ||
      !['won', 'lost'].includes(state.match.result.outcome))) {
    throw new ProtocolError('INVALID_STATE', 'State match result must identify a player and a won/lost outcome.');
  }
  if (!Array.isArray(state.players)) throw new ProtocolError('INVALID_STATE', 'State players must be an array.');
  const playerIds = new Set();
  const unitIds = new Set();
  state.players.forEach((player, index) => {
    if (!isPlainObject(player) || typeof player.id !== 'string' || !player.id) {
      throw new ProtocolError('INVALID_STATE', `Player ${index} has no valid ID.`);
    }
    const id = player.id;
    if (playerIds.has(id)) throw new ProtocolError('INVALID_STATE', `Player ID ${id} occurs more than once.`);
    playerIds.add(id);
    validatePlayer(player, id);
    for (const collection of UNIT_COLLECTIONS) {
      const values = player[collection];
      if (values === undefined) continue;
      if (!isPlainObject(values)) throw new ProtocolError('INVALID_STATE', `Player ${id} ${collection} must be an instance map.`);
      for (const [key, unit] of Object.entries(values)) {
        validateUnit(unit, key);
        if (unitIds.has(key)) throw new ProtocolError('INVALID_STATE', `Unit ${key} occurs in multiple collections or owners.`);
        unitIds.add(key);
        if (collection === 'heroes') validateHero(unit, id);
        if (collection === 'buildings') {
          if (unit.production !== undefined && (!isPlainObject(unit.production) || !validQueue(unit.production.queue))) {
            throw new ProtocolError('INVALID_STATE', `Building ${key} has invalid production.`);
          }
          if (unit.construction !== undefined && !validTimedProgress(unit.construction)) {
            throw new ProtocolError('INVALID_STATE', `Building ${key} has invalid construction progress.`);
          }
        }
      }
    }
    if (player.upgrades !== undefined) validateUpgrades(player.upgrades, id);
  });
  if (state.application !== undefined) {
    if (!isPlainObject(state.application) || state.application.clientId !== clientId) {
      throw new ProtocolError('APPLICATION_MISMATCH', 'This state belongs to a different application.');
    }
    if (!isPlainObject(state.application.settings)) {
      throw new ProtocolError('INVALID_STATE', 'Application settings must be an object.');
    }
    if (state.application.data !== undefined && !isPlainObject(state.application.data)) {
      throw new ProtocolError('INVALID_STATE', 'Application data must be an object when present.');
    }
    validateOptionalFields(state.application, { surface: 'string', development: 'boolean' }, 'Application state');
    if (state.application.surface !== undefined && !APP_SURFACES.has(state.application.surface)) {
      throw new ProtocolError('INVALID_STATE', `Unknown application surface: ${state.application.surface}`);
    }
  }
  if (!isPlainObject(state.gameContext) || !Number.isFinite(state.gameContext.hudScale)) {
    throw new ProtocolError('INVALID_STATE', 'Game context must contain a finite hudScale.');
  }
  validateOptionalFields(state.gameContext, { chatbarOpen: 'boolean', teamColors: 'boolean' }, 'Game context');
  if (state.gameContext.hudScale < 0.5 || state.gameContext.hudScale > 1) {
    throw new ProtocolError('INVALID_STATE', 'Game context hudScale must be between 0.5 and 1.0.');
  }
  if (state.overlay !== undefined && (!isPlainObject(state.overlay) ||
      ['runtime', 'misc', 'settings'].some(key => key in state.overlay))) {
    throw new ProtocolError('INVALID_STATE', 'Overlay extensions cannot contain retired runtime, misc, or settings branches.');
  }
  if (state.transport !== undefined && (!isPlainObject(state.transport) ||
      !Array.isArray(state.transport.recorderUrls) || state.transport.recorderUrls.some(url => typeof url !== 'string'))) {
    throw new ProtocolError('INVALID_STATE', 'Transport metadata must contain recorderUrls.');
  }
  return state;
}

/** Normalize producer transport escaping exactly once before patch application. */
export function normalizeStatePatch(operations) {
  if (!Array.isArray(operations)) return operations;
  return operations.map(operation => {
    if (!isPlainObject(operation) || operation.op === 'remove') return operation;
    if (operation.path === '/match/map' && typeof operation.value === 'string') {
      return { ...operation, value: decodeDisplayValue(operation.value) };
    }
    if (operation.path !== '' && operation.path !== '/match') return operation;
    if (!isPlainObject(operation.value)) return operation;
    const value = structuredCloneSafe(operation.value);
    if (operation.path === '') normalizeMatchMap(value);
    else if (typeof value.map === 'string') value.map = decodeDisplayValue(value.map);
    return { ...operation, value };
  });
}

function normalizeMatchMap(state) {
  if (isPlainObject(state.match) && typeof state.match.map === 'string') {
    state.match.map = decodeDisplayValue(state.match.map);
  }
}

function decodeDisplayValue(value) {
  try { return decodeURIComponent(value); }
  catch (_) { return value; }
}

function validatePlayer(player, id) {
  validateOptionalFields(player, { name: 'string', team: 'number', colorId: 'number', isAI: 'boolean' }, `Player ${id}`);
  if (player.race !== undefined && (!RACES.has(player.race))) {
    throw new ProtocolError('INVALID_STATE', `Player ${id} has an invalid race.`);
  }
  if (player.startPosition !== undefined) validatePoint(player.startPosition, `Player ${id} startPosition`);
  if (player.resources !== undefined) validateResources(player.resources, id);
  if (player.controlgroups !== undefined) validateControlGroups(player.controlgroups, id);
  if (player.stats !== undefined) validateStatsCollection(player.stats, id);
  if (player.mainAccount !== undefined) validateMainAccount(player.mainAccount, id);
}

function validatePoint(value, label) {
  if (!isPlainObject(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new ProtocolError('INVALID_STATE', `${label} must contain finite x and y coordinates.`);
  }
}

function validateResources(resources, playerId) {
  if (!isPlainObject(resources)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} resources must be an object.`);
  for (const field of ['gold', 'lumber', 'supply', 'supplyCap']) {
    if (!Number.isFinite(resources[field])) throw new ProtocolError('INVALID_STATE', `Player ${playerId} resources.${field} must be a finite number.`);
  }
  if (resources.workerSupply !== undefined && !Number.isFinite(resources.workerSupply)) {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} resources.workerSupply must be a finite number.`);
  }
}

function validateControlGroups(controlgroups, playerId) {
  if (!isPlainObject(controlgroups)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} controlgroups must be an object.`);
  for (const [key, group] of Object.entries(controlgroups)) {
    if (!isPlainObject(group) || typeof group.frontunit !== 'string' || !Number.isFinite(group.size)) {
      throw new ProtocolError('INVALID_STATE', `Player ${playerId} controlgroup ${key} is invalid.`);
    }
  }
}

function validateStatsCollection(stats, playerId) {
  if (!isPlainObject(stats)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} stats must be an object.`);
  if (!['loading', 'ready', 'unavailable'].includes(stats.status)) throw new ProtocolError('INVALID_STATE', 'Invalid stats status.');
  if (!Array.isArray(stats.records) || stats.records.length > 128) throw new ProtocolError('INVALID_STATE', 'Stats records must be an array.');
  for (const value of stats.records) {
    if (!isPlainObject(value) || !['bnet', 'w3champions', 'netease'].includes(value.provider) ||
        !['1v1', '2v2', '3v3', '4v4', 'ffa'].includes(value.gameMode) || !['individual', 'arranged'].includes(value.queue) ||
        !Number.isInteger(value.wins) || value.wins < 0 || !Number.isInteger(value.losses) || value.losses < 0 || !Number.isFinite(value.winRate)) {
      throw new ProtocolError('INVALID_STATE', `Player ${playerId} stats record is invalid.`);
    }
    if (value.winRate < 0 || value.winRate > 100) throw new ProtocolError('INVALID_STATE', 'Stats winRate must be between 0 and 100.');
    validateOptionalFields(value, { mmr: 'number', rank: 'number', level: 'number', xp: 'number', season: 'number', isPlaced: 'boolean' }, 'Stats record');
    if (value.race !== undefined && !RACES.has(value.race)) throw new ProtocolError('INVALID_STATE', 'Invalid stats race.');
    if (value.league !== undefined && !(typeof value.league === 'string' || Number.isFinite(value.league))) throw new ProtocolError('INVALID_STATE', 'Invalid stats league.');
    if (value.queue === 'arranged') {
      if (!['2v2', '3v3', '4v4'].includes(value.gameMode) || value.race !== undefined || !isPlainObject(value.team) ||
          typeof value.team.id !== 'string' || !value.team.id || !Array.isArray(value.team.members) ||
          value.team.members.length < 2 || value.team.members.length > Number(value.gameMode[0]) || value.team.members.some(member =>
            !isPlainObject(member) || typeof member.battleTag !== 'string' || !member.battleTag.includes('#') ||
            (member.id !== undefined && typeof member.id !== 'string') || (member.gatewayId !== undefined && !Number.isInteger(member.gatewayId)))) {
        throw new ProtocolError('INVALID_STATE', 'Invalid arranged team identity.');
      }
    } else if (value.team !== undefined) throw new ProtocolError('INVALID_STATE', 'Individual stats cannot have a team.');
  }
}

function validateMainAccount(account, playerId) {
  if (!isPlainObject(account) || typeof account.name !== 'string') {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} mainAccount is invalid.`);
  }
  validateOptionalFields(account, { country: 'string' }, `Player ${playerId} mainAccount`);
  if (account.mainRace !== undefined && !RACES.has(account.mainRace)) {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} mainAccount.mainRace is invalid.`);
  }
}

function validateUnit(unit, key) {
  if (!isPlainObject(unit) || !isInstanceId(key) || unit.id !== key || !isTypeId(unit.typeId)) {
    throw new ProtocolError('INVALID_STATE', `Unit ${key} has an invalid identity or typeId.`);
  }
  if (typeof unit.isIllusion !== 'boolean') {
    throw new ProtocolError('INVALID_STATE', `Unit ${key} must contain a boolean isIllusion.`);
  }
  for (const field of ['hitpoints', 'mana']) {
    if (unit[field] !== undefined && !validPool(unit[field])) throw new ProtocolError('INVALID_STATE', `Unit ${key} has invalid ${field}.`);
  }
  if (unit.position !== undefined && (!isPlainObject(unit.position) || !Number.isFinite(unit.position.x) || !Number.isFinite(unit.position.y))) {
    throw new ProtocolError('INVALID_STATE', `Unit ${key} has invalid position.`);
  }
}

function validateHero(hero, playerId) {
  if (!isPlainObject(hero) || typeof hero.id !== 'string' || !hero.id || (hero.level !== undefined && (!Number.isInteger(hero.level) || hero.level < 1))) {
    throw new ProtocolError('INVALID_STATE', `Player ${playerId} contains a hero without a valid ID.`);
  }
  if (Object.prototype.hasOwnProperty.call(hero, 'items')) {
    throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} must use inventory, not items.`);
  }
  if (hero.inventory !== undefined && (!Array.isArray(hero.inventory) || hero.inventory.some(item => typeof item !== 'string'))) {
    throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} inventory must be an array of rawcodes.`);
  }
  if (hero.heroOrder !== undefined && (!Number.isInteger(hero.heroOrder) || hero.heroOrder < 1 || hero.heroOrder > 0x7fffffff)) {
    throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} heroOrder must be a positive signed 32-bit integer.`);
  }
  if (hero.experience !== undefined && !Number.isFinite(hero.experience)) {
    throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} experience must be a finite number.`);
  }
  for (const field of ['hitpoints', 'mana']) {
    if (hero[field] !== undefined && (!isPlainObject(hero[field]) || !Number.isFinite(hero[field].current) || !Number.isFinite(hero[field].max))) {
      throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} ${field} must contain finite current and max values.`);
    }
  }
  if (hero.abilities !== undefined) {
    if (!Array.isArray(hero.abilities)) throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} abilities must be an array.`);
    const abilityIds = new Set();
    for (const ability of hero.abilities) {
      if (!isPlainObject(ability) || typeof ability.id !== 'string' || !ability.id || typeof ability.typeId !== 'string' || !ability.typeId || !Number.isFinite(ability.level) ||
          (ability.lastActivation !== undefined && (!Number.isFinite(ability.lastActivation) || ability.lastActivation <= 0))) {
        throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} contains an invalid ability.`);
      }
      if (abilityIds.has(ability.id)) throw new ProtocolError('INVALID_STATE', `Hero ${String(hero.id)} ability ID ${ability.id} occurs more than once.`);
      abilityIds.add(ability.id);
    }
  }
}

function validateUpgrades(upgrades, playerId) {
  if (!isPlainObject(upgrades)) throw new ProtocolError('INVALID_STATE', `Player ${playerId} upgrades must be an object.`);
  for (const collection of ['upgrades', 'active', 'researching']) {
    if (!Array.isArray(upgrades[collection])) {
      throw new ProtocolError('INVALID_STATE', `Player ${playerId} upgrades.${collection} must be an array.`);
    }
    for (const upgrade of upgrades[collection]) {
      if (!isPlainObject(upgrade) || typeof upgrade.typeId !== 'string' || !upgrade.typeId ||
          !Number.isFinite(upgrade.level) || upgrade.level < 1 || !Number.isFinite(upgrade.gametime)) {
        throw new ProtocolError('INVALID_STATE', `Player ${playerId} contains an invalid ${collection} upgrade.`);
      }
      if (upgrade.typeId.length > 4 && /^\d+$/.test(upgrade.typeId.slice(4))) {
        throw new ProtocolError('INVALID_STATE', `Upgrade ${upgrade.typeId} must carry its level separately.`);
      }
      if (collection === 'researching') {
        if (!validTimedProgress(upgrade)) {
          throw new ProtocolError('INVALID_STATE', `Player ${playerId} researching upgrade has invalid timing.`);
        }
      }
    }
  }
}

function validateOptionalFields(value, fields, label) {
  for (const [field, type] of Object.entries(fields)) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== type || type === 'number' && !Number.isFinite(value[field])) {
      throw new ProtocolError('INVALID_STATE', `${label}.${field} must be a ${type}.`);
    }
  }
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function applyPatch(current, operations) {
  if (!Array.isArray(operations)) throw new ProtocolError('INVALID_PATCH', 'State patch data must be an array.');
  let next = current || {};
  for (const operation of operations) {
    if (!isPlainObject(operation) || !['add', 'replace', 'remove'].includes(operation.op) || typeof operation.path !== 'string') {
      throw new ProtocolError('INVALID_PATCH', 'State patch contains an unsupported operation.');
    }
    if (operation.op !== 'remove') assertSafeValue(operation.value, 'patch.value');
    if (operation.path === '') {
      if (operation.op === 'remove') throw new ProtocolError('INVALID_PATCH', 'The complete state cannot be removed.');
      next = structuredCloneSafe(operation.value);
      continue;
    }
    if (!operation.path.startsWith('/')) throw new ProtocolError('INVALID_PATCH', 'State patch paths must be JSON pointers.');
    const path = operation.path.split('/').slice(1).map(decodePointerPart);
    if (path.some(part => UNSAFE_OBJECT_KEYS.has(part))) {
      throw new ProtocolError('UNSAFE_PATCH', 'State patch attempted to modify an unsafe object key.');
    }
    const key = path.pop();
    const lineage = [];
    let parent = next;
    for (const part of path) {
      if (parent == null || typeof parent !== 'object') {
        throw new ProtocolError('INVALID_PATCH', `State patch parent does not exist: ${operation.path}`);
      }
      lineage.push({ container: parent, key: part });
      parent = parent[part];
    }
    if (parent == null || (typeof parent !== 'object' && !Array.isArray(parent))) {
      throw new ProtocolError('INVALID_PATCH', `State patch parent does not exist: ${operation.path}`);
    }
    let replacement = Array.isArray(parent) ? [...parent] : { ...parent };
    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index > parent.length) {
        throw new ProtocolError('INVALID_PATCH', `State patch array index is invalid: ${operation.path}`);
      }
      if (operation.op === 'remove') {
        if (index >= parent.length) throw new ProtocolError('INVALID_PATCH', `State patch array item does not exist: ${operation.path}`);
        replacement.splice(index, 1);
      } else if (operation.op === 'add') replacement.splice(index, 0, structuredCloneSafe(operation.value));
      else {
        if (index >= parent.length) throw new ProtocolError('INVALID_PATCH', `State patch array item does not exist: ${operation.path}`);
        if (deepEqual(parent[index], operation.value)) continue;
        replacement[index] = structuredCloneSafe(operation.value);
      }
    } else if (operation.op === 'remove') {
      if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new ProtocolError('INVALID_PATCH', `State patch property does not exist: ${operation.path}`);
      delete replacement[key];
    } else {
      if (operation.op === 'replace' && !Object.prototype.hasOwnProperty.call(parent, key)) {
        throw new ProtocolError('INVALID_PATCH', `State patch property does not exist: ${operation.path}`);
      }
      if (deepEqual(parent[key], operation.value)) continue;
      replacement[key] = structuredCloneSafe(operation.value);
    }
    for (let index = lineage.length - 1; index >= 0; index--) {
      const { container, key: parentKey } = lineage[index];
      const ancestor = Array.isArray(container) ? [...container] : { ...container };
      ancestor[parentKey] = replacement;
      replacement = ancestor;
    }
    next = replacement;
  }
  return next;
}

function decodePointerPart(part) {
  if (/~(?:[^01]|$)/.test(part)) throw new ProtocolError('INVALID_PATCH', 'State patch contains an invalid JSON pointer escape.');
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}
