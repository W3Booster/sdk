# Generated Warcraft data (SDK 4)

`@w3booster/sdk/game-data` loads one immutable current-melee dataset by
`state.match.gameDataId`, using `loadGameData(id, { baseUrl?, signal?, fetch? })`.
The native recorder advertises its compiled catalog revision only when the running
game version matches. `gameVersion` is also exposed. An absent revision means no
matching standard catalog is available; keep live values and omit static decoration.
Never substitute `current.json` or guess a nearby version in a consumer.

The loader verifies catalog and optional gameplay checksums and the manifest build.
Successful results are cached by fetch implementation, base URL and revision.
Aborted/failed requests are retryable. A catalog is shared and immutable.

- `data.units.get(typeId)`: cost, supply, base stats, build time, ability and production relationships.
- `data.abilities.get(typeId)`: maximum level and per-level cooldown, mana cost, cast time and range.
- `data.items.get(typeId)`: cost and ability relationships.
- `data.upgrades.get(typeId)`: source category and ordered levels with name, cost and research time.
- Each collection supports `has(typeId)` and `values()`.
- `data.assets.unitIcon/abilityIcon/itemIcon/upgradeIcon(typeId, { graphics, level?, role? })`:
  content-hashed hosted image URLs. `graphics` is `classic` or `reforged`; level is
  one-based; roles are `icon`, `research` and `inactive`. A single frame is shared
  across levels, while ordered source lists retain their level order.
- `await data.unitGameplay(typeId)`: separately fetched broad retained source fields.
  These are source strings grouped by source section, not fully resolved live stats.
- `abilityCooldown(ability, gameTime, data)` and `abilityCooldownsForState(state, data)`:
  estimates from actual rawcode, level and observed activation time. Whole-state
  derivation requires a matching revision and an active match.

For group sorting, join `unit.typeId` to `data.units.get(unit.typeId)?.cost`.
Choose an explicit ordering, such as gold descending then lumber descending;
there is no universal conversion between gold and lumber. Keep unknown costs last.

The private platform patch toolchain extracts current base object tables and skin
references, selects melee/current and Classic/Reforged qualifiers, extracts exact
CASC texture paths, then emits catalog and artwork together. English names are
source display labels. Rawcodes remain case-sensitive. Historical balance layers,
custom-map overrides, filename guesses, aliases and placeholder icons are excluded.
If a referenced Classic texture only exists in HD, the same source path's HD texture
is used and reported in generation evidence. Missing references fail generation.
Objects with no configured art legitimately have no image.

SDK 4 breaking changes:

- `HeroAbility.name` and upgrade `name` become `typeId`; upgrade level suffixes are removed.
- Ability rawcodes retain their actual variant; ultimate levels are no longer changed to zero.
- `/standard-game/icons`, `/standard-game/cooldowns`, `normalizeUpgradeRawcode`,
  `isWeaponOrArmorUpgrade` and `weaponOrArmorUpgradeRawcodes` are removed.
- Upgrade classification uses `data.upgrades.get(typeId)?.category` (`armor`, `melee`,
  `ranged`, `caster` or another source category). Level indicators use `maxLevel`.
- Protocol 4 requires a coordinated recorder/API/SDK/application release.

SDK publication and static/native/platform releases are separate authorized actions.
A local packed SDK verifies the candidate without implying that it is published.

The catalog loader requires browser Web Crypto (`crypto.subtle`) for integrity verification.
Node 18 tools can supply `globalThis.crypto` from `node:crypto` before loading a catalog.
