import { finiteNonNegative } from './internal/numbers.js';
import { createImmutableSelector } from './internal/immutable-selector.js';
import { cooldowns } from './standard-game-cooldown-data.js';

class ImmutableMap extends Map {
  constructor(entries) {
    super();
    if (entries) for (const [key, value] of entries) Map.prototype.set.call(this, key, value);
    Object.freeze(this);
  }

  /** @returns {this} */
  set(_key, _value) { throw new TypeError('Cooldown maps are immutable.'); }
  /** @returns {boolean} */
  delete(_key) { throw new TypeError('Cooldown maps are immutable.'); }
  clear() { throw new TypeError('Cooldown maps are immutable.'); }
}

for (const values of Object.values(cooldowns)) Object.freeze(values);
Object.freeze(cooldowns);
const EMPTY_COOLDOWNS = new ImmutableMap();
const selectAbilityCooldowns = createImmutableSelector(state => {
  const result = new Map();
  if (!Number.isFinite(state?.match?.gameTime) || state.match.gameTime < 0 ||
      state.match.status === 'none' || state.match.status === 'finished') return EMPTY_COOLDOWNS;
  for (const player of state.players || []) {
    for (const hero of player.heroes || []) {
      for (const ability of hero.abilities || []) {
        if (!ability.lastActivation || ability.lastActivation <= 0) continue;
        const cooldown = abilityCooldown(ability, state.match.gameTime);
        if (cooldown) result.set(ability, cooldown);
      }
    }
  }
  return result.size > 0 ? new ImmutableMap(result) : EMPTY_COOLDOWNS;
});

export function getAbilityCooldown(rawcode, level = 1) {
  const values = cooldowns[rawcode];
  const rawValue = values?.[Math.max(1, Math.trunc(level) || 1) - 1];
  if (rawValue === null || rawValue === undefined) return undefined;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : undefined;
}

/** Derive a standard-game cooldown without exposing transport timestamp units. */
export function abilityCooldown(ability, gameTime) {
  const total = getAbilityCooldown(ability?.name, ability?.level);
  const activation = Number(ability?.lastActivation);
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0 || !Number.isFinite(activation) || activation <= 0) return undefined;
  const elapsed = Math.max(0, finiteNonNegative(gameTime) - activation / 1000);
  const remaining = Math.max(0, total - elapsed);
  return Object.freeze({ total, elapsed, remaining, progress: Math.min(1, elapsed / total), active: remaining > 0 });
}

/** Index active and completed standard-game ability cooldowns by their hydrated ability objects. */
export function abilityCooldownsForState(state) {
  return selectAbilityCooldowns(state);
}
