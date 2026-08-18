import { finiteNonNegative } from './internal/numbers.js';
import { cooldowns } from './standard-game-cooldown-data.js';

for (const values of Object.values(cooldowns)) Object.freeze(values);
Object.freeze(cooldowns);

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
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(activation) || activation <= 0) return undefined;
  const elapsed = Math.max(0, finiteNonNegative(gameTime) - Math.ceil(activation / 1000));
  const remaining = Math.max(0, total - elapsed);
  return { total, elapsed, remaining, progress: Math.min(1, elapsed / total), active: remaining > 0 };
}

/** Index active and completed standard-game ability cooldowns by their hydrated ability objects. */
export function abilityCooldownsForState(state) {
  const result = new Map();
  if (!state?.match?.gameTime || state.match.status === 'none' || state.match.status === 'finished') return result;
  for (const player of state.players || []) {
    for (const hero of player.heroes || []) {
      for (const ability of hero.abilities || []) {
        if (!ability.lastActivation || ability.lastActivation <= 0) continue;
        const cooldown = abilityCooldown(ability, state.match.gameTime);
        if (cooldown) result.set(ability, cooldown);
      }
    }
  }
  return result;
}
