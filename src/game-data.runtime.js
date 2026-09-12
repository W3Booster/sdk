import { normalizeAssetBaseUrl, resolveAssetBaseUrl } from './assets.js';
import { createImmutableSelector } from './internal/immutable-selector.js';
import { deepFreeze } from './internal/values.js';

const REVISION = /^\d+(?:\.\d+){3}-[a-f0-9]{16}$/;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = ['units', 'abilities', 'items', 'upgrades'];
const cache = new WeakMap();

async function jsonFile(fetcher, url, signal, expected, limit) {
  const response = await fetcher(url, { signal, credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Game data request failed (${response.status})`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Game data exceeds size limit');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error('Game data exceeds size limit');
  if (expected) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected) throw new Error('Game data checksum mismatch');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** @type {import('./game-data-contracts.js').loadGameData} */
export async function loadGameData(id, options = {}) {
  if (!REVISION.test(id)) throw new TypeError('A valid gameDataId is required');
  const base = normalizeAssetBaseUrl(options.baseUrl ?? resolveAssetBaseUrl());
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new TypeError('fetch is unavailable');
  options.signal?.throwIfAborted();
  let entries = cache.get(fetcher);
  if (!entries) { entries = new Map(); cache.set(fetcher, entries); }
  const key = `${base}/${id}`;
  if (entries.has(key)) return entries.get(key);
  const root = `${base}/wc3/game-data/${id}`;
  const manifest = await jsonFile(fetcher, `${root}/manifest.json`, options.signal, undefined, 16 * 1024);
  if (manifest.schemaVersion !== 1 || manifest.id !== id || manifest.ruleset !== 'current-melee' ||
      manifest.gameVersion !== id.slice(0, id.lastIndexOf('-'))) throw new Error('Game data revision mismatch');
  for (const name of ['catalog.json', 'unit-gameplay.json']) {
    if (!HASH.test(manifest.files?.[name]?.sha256)) throw new Error('Invalid game data manifest');
  }
  const catalog = await jsonFile(fetcher, `${root}/catalog.json`, options.signal, manifest.files['catalog.json'].sha256, 1536 * 1024);
  if (catalog.schemaVersion !== 1 || catalog.gameVersion !== manifest.gameVersion || catalog.ruleset !== manifest.ruleset ||
      !Array.isArray(catalog.images) || catalog.images.some(hash => !HASH.test(hash))) throw new Error('Invalid game data catalog');
  for (const kind of KINDS) {
    if (!catalog[kind] || typeof catalog[kind] !== 'object' || Array.isArray(catalog[kind])) throw new Error('Missing object catalog');
    for (const [typeId, entry] of Object.entries(catalog[kind])) {
      if (!/^[A-Za-z0-9]{4}$/.test(typeId) || !entry || typeof entry !== 'object' || entry.typeId !== typeId) throw new Error('Invalid object identity');
    }
  }
  deepFreeze(catalog);
  const collection = kind => {
    const values = Object.freeze(Object.values(catalog[kind]).map(entry => {
      const { artwork: _artwork, ...value } = entry;
      return Object.freeze(value);
    }));
    const byId = new Map(values.map(entry => [entry.typeId, entry]));
    return Object.freeze({ get: typeId => byId.get(typeId), has: typeId => byId.has(typeId), values: () => values });
  };
  const icon = (kind, typeId, { graphics, level = 1, role = 'icon' }) => {
    if (!KINDS.includes(kind) || !['classic', 'reforged'].includes(graphics) || !['icon', 'research', 'inactive'].includes(role)) {
      throw new TypeError('Invalid object icon options');
    }
    if (!Number.isInteger(level) || level < 1) return undefined;
    const object = Object.prototype.hasOwnProperty.call(catalog[kind], typeId) ? catalog[kind][typeId] : undefined;
    if (!object || (object.maxLevel > 0 && level > object.maxLevel)) return undefined;
    const frames = object.artwork?.[role]?.[graphics];
    if (!Array.isArray(frames) || !frames.length) return undefined;
    // One source frame is shared across levels; explicit multi-frame lists remain ordered.
    const index = frames[Math.min(level, frames.length) - 1];
    if (!Number.isInteger(index) || index < 0 || !catalog.images[index]) return undefined;
    return `${base}/wc3/images/${catalog.images[index]}.png`;
  };
  let gameplay;
  const data = {
    id, gameVersion: manifest.gameVersion, ruleset: manifest.ruleset,
    units: collection('units'), abilities: collection('abilities'), items: collection('items'), upgrades: collection('upgrades'),
    assets: Object.freeze({ icon,
      unitIcon: (typeId, options) => icon('units', typeId, options),
      abilityIcon: (typeId, options) => icon('abilities', typeId, options),
      itemIcon: (typeId, options) => icon('items', typeId, options),
      upgradeIcon: (typeId, options) => icon('upgrades', typeId, options) }),
    /** @param {string} typeId @param {{signal?: AbortSignal}} options */
    async unitGameplay(typeId, { signal } = {}) {
      if (!Object.prototype.hasOwnProperty.call(catalog.units, typeId)) return undefined;
      signal?.throwIfAborted();
      const source = gameplay ?? await jsonFile(fetcher, `${root}/unit-gameplay.json`, signal,
        manifest.files['unit-gameplay.json'].sha256, 320 * 1024);
      if (source.format !== 'w3-unit-source-columns-v1' || source.gameVersion !== manifest.gameVersion) throw new Error('Invalid gameplay projection');
      gameplay = deepFreeze(source);
      const result = {};
      for (const block of source.blocks) {
        const row = block.rows[typeId];
        if (!row) continue;
        const fields = {};
        const indexes = [...block.defaults];
        for (let index = 0; index < row.length; index += 2) indexes[row[index]] = row[index + 1];
        for (let index = 0; index < indexes.length; index++) if (indexes[index] !== -1) fields[block.columns[index]] = source.values[indexes[index]];
        result[block.name] = Object.freeze(fields);
      }
      return Object.freeze(result);
    }
  };
  options.signal?.throwIfAborted();
  Object.freeze(data);
  entries.set(key, data);
  return data;
}

/** @type {import('./game-data-contracts.js').abilityCooldown} */
export function abilityCooldown(ability, gameTime, data) {
  const type = data.abilities.get(ability.typeId);
  const total = type?.levels[ability.level - 1]?.cooldownSeconds;
  if (typeof total !== 'number' || total <= 0 || !Number.isFinite(gameTime) ||
      !Number.isFinite(ability.lastActivation) || !ability.lastActivation || ability.lastActivation <= 0) return undefined;
  const elapsed = Math.max(0, gameTime - ability.lastActivation / 1000);
  const remaining = Math.max(0, total - elapsed);
  return Object.freeze({ totalSeconds: total, remainingSeconds: remaining, progress: Math.min(1, elapsed / total), active: remaining > 0 });
}

/** @type {import('./game-data-contracts.js').abilityCooldownsForState} */
export const abilityCooldownsForState = createImmutableSelector((state, data) => {
  const result = new Map();
  if (state.match.gameDataId === data.id && !['none', 'finished'].includes(state.match.status)) {
    for (const player of state.players) for (const hero of Object.values(player.heroes || {})) {
      for (const ability of hero.abilities || []) {
        const cooldown = abilityCooldown(ability, state.match.gameTime, data);
        if (cooldown) result.set(ability, cooldown);
      }
    }
  }
  const view = { get size() { return result.size; }, get: key => result.get(key), has: key => result.has(key),
    entries: () => result.entries(), keys: () => result.keys(), values: () => result.values(),
    forEach: (callback, thisArg) => result.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => result[Symbol.iterator]() };
  return Object.freeze(view);
});
