import { cooldowns } from './standard-game-cooldown-data.js';
import { icons } from './standard-game-icon-data.js';

export {
  abilityIconUrl,
  assetBaseUrl,
  assetCatalogVersion,
  assetManifestUrl,
  createAssetResolver,
  getIcon,
  heroIconUrl,
  iconFileName,
  iconUrl,
  itemIconUrl,
  upgradeIconUrl
} from './standard-game-icons.js';
export {
  abilityCooldown,
  abilityCooldownsForState,
  getAbilityCooldown
} from './standard-game-cooldowns.js';

const objects = {};
for (const [rawcode, icon] of Object.entries(icons)) {
  const values = cooldowns[rawcode];
  const metadata = { icon };
  values?.forEach((value, index) => {
    if (value !== null) metadata[`Cool${index + 1}`] = value;
  });
  objects[rawcode] = Object.freeze(metadata);
}
Object.freeze(objects);

/** Shipped Warcraft III object metadata keyed by four-character rawcode. */
export { objects };

export function getObject(rawcode) {
  return Object.prototype.hasOwnProperty.call(objects, rawcode) ? objects[rawcode] : undefined;
}

export function numberField(rawcode, field) {
  const value = Number(getObject(rawcode)?.[field]);
  return Number.isFinite(value) ? value : undefined;
}
