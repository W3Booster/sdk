import type { TimedProgress, HeroAbility, MatchState } from './index.js';

export interface AbilityCooldownState extends TimedProgress {
  readonly totalSeconds: number;
  readonly remainingSeconds: number;
  readonly progress: number;
  readonly active: boolean;
}
export function getAbilityCooldown(rawcode: string, level?: number): number | undefined;
export function abilityCooldown(ability: HeroAbility, gameTime: number): AbilityCooldownState | undefined;
/** A frozen ReadonlyMap facade whose backing Map is inaccessible to consumers. */
export function abilityCooldownsForState<TSettings extends object>(state: MatchState<TSettings>): ReadonlyMap<HeroAbility, AbilityCooldownState>;
