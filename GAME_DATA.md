# Generated Warcraft data (SDK 4)

For practical app ideas and checked examples, explore the dedicated
[Warcraft catalog and artwork guide](https://w3booster.com/developer/catalog-data/).

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
- `data.items.get(typeId)`: cost, ability relationships and optional `initialCharges` (standard starting charges).
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

## Building upgrades and item cooldowns

Static configuration and live observations share Warcraft type IDs. Resolve
`building.upgrade.typeId` through `data.units` / `data.assets.unitIcon()` for the
destination being upgraded to. Keep this activity separate from the building's
training/research `production.queue`.

```ts
const upgrade = building.upgrade;
const itemTypeId = hero.inventory?.[slot];
const cooldown = hero.inventoryCooldowns?.[slot];
// Both activities have progress (completed 0..1), remainingSeconds, totalSeconds.
```

`inventoryCooldowns` contains directly read engine timers aligned with inventory
slots, including duplicates and empty slots. A missing array means unavailable;
a null slot means no observed active cooldown. Timing members may be null when
unavailable. Do not advance snapshots using wall-clock time while Warcraft is
paused. The ability cooldown helper produces the same timing fields plus `active`,
but currently derives its values from the last activation and catalog duration.

Items sharing an icon still have independent `typeId` values. The compact item
catalog currently exposes names, costs and linked abilities, not normalized
numeric damage/armor effects. Do not parse names or legacy rawcode suffixes as
balance values (for example, `rat6` is named Claws of Attack +5 in 3.0.0.24268).

## Inventory charges

Join live `Hero.inventoryCharges[slot]` with
`data.items.get(hero.inventory[slot])?.initialCharges` from the catalog loaded
for `match.gameDataId`. Remaining counts belong to the hero snapshot; the
starting default belongs to the shared catalog.

Example hero fields:

```json
{
  "id": "00002ba700002ba7",
  "typeId": "Hamg",
  "isIllusion": false,
  "inventory": ["hslv", "hslv", "phea", "bspd", "", ""],
  "inventoryCharges": [3, 1, 1, 0, null, null]
}
```

Corresponding item catalog fields:

```json
{
  "typeId": "hslv",
  "name": "Healing Salve",
  "initialCharges": 3
}
```

- Indices match inventory slots, including empty slots and duplicate item types.
  Never join live counts by rawcode or compact either array separately.
- Counts are nonnegative integers. `0` is known zero, `null` is an empty or
  unobserved slot, and a missing array means charge observations are unavailable.
- Catalog `initialCharges` is optional standard configuration, not the count
  recorded when this particular item was acquired, a lifetime maximum, or shop
  stock. Custom maps and modified item counts can differ.
- Never substitute the catalog default for an unavailable live count or infer
  charges from cooldowns. Replacing inventory without counts clears old counts.
- Charges follow the existing `heroes:read` and player-ownership rules. Subscribe
  to state or `hero.changed` for live count changes, including unchanged rawcodes.

A remaining-charge display can show three dots for a salve with capacity three,
filling one when one remains: **● ○ ○**. Show all empty dots for a known zero.
Hide indicators for missing data or defaults of one or less. If the observed
count exceeds the default, show the numeric count instead. Match Vision also
uses a number above ten starting charges to keep its compact icons readable.
Empty dots describe normal capacity; they do not prove how many uses occurred.
