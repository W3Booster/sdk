import type { HeroAbility, MatchState } from './index.js';
import type { AbilityCooldownState } from './standard-game-cooldowns.js';
export type { AbilityCooldownState } from './standard-game-cooldowns.js';
export {
  type AssetUrlOptions,
  type CreateAssetResolverOptions,
  type StandardGameAssetResolver,
  type WarcraftGraphics,
  abilityIconUrl,
  assetBaseUrl,
  assetCatalogVersion,
  assetManifestUrl,
  createAssetResolver,
  getIcon,
  heroIconUrl,
  iconFileName,
  iconFilenameUrl,
  iconUrl,
  itemIconUrl,
  upgradeIconUrl
} from './standard-game-icons.js';

export interface StandardGameObjectMetadata {
  readonly icon?: string;
  readonly [field: string]: string | undefined;
}
export const objects: Readonly<Record<string, StandardGameObjectMetadata>>;
export function getObject(rawcode: string): StandardGameObjectMetadata | undefined;
export function getAbilityCooldown(rawcode: string, level?: number): number | undefined;
export function numberField(rawcode: string, field: string): number | undefined;
export function abilityCooldown(ability: HeroAbility, gameTime: number): AbilityCooldownState | undefined;
/** A native Map whose mutating methods reject at runtime; exposed read-only to consumers. */
export function abilityCooldownsForState<TSettings extends object>(state: MatchState<TSettings>): ReadonlyMap<HeroAbility, AbilityCooldownState>;
