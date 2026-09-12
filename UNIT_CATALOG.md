# Current unit catalog: size preparation

This documents the broad unit-data compaction policy used by the platform patch
workflow. SDK 4 exposes its generated output through `GameData.unitGameplay()`;
[GAME_DATA.md](GAME_DATA.md) documents the unified typed/artwork API. Data comes from
Warcraft III **2.0.4.23745**, not the retired unversioned platform JSON.

## Scope

Only current Frozen Throne melee balance is wanted. The original 4,371,216-byte
prototype already excluded the separate legacy balance directories. It still
contained 438 legacy profile property overrides; the compactor removes these.
It retains relevant explicit melee V1 overrides. It does not remove campaign
units, creeps, summons or buildings just to reduce size: those remain unit types
in the current game's object configuration.

The user authorized dropping editor fields that do not serve likely SDK use
cases. The projection in scripts/unit-catalog/policy.mjs keeps:

- Identity: rawcodes, English display names, race, building/campaign flags and
  gameplay classifications.
- Economy: gold/lumber costs, food used/provided, build time, repair cost/time,
  gold/lumber bounty dice and shop stock/replenishment settings.
- Base stats: health, mana, regeneration, armor/type/upgrades, movement speed/type,
  turn rate, collision size, day/night sight and transport space.
- Combat: both attacks, enabled attack bits, damage/dice/upgrades, attack and
  weapon types, targets, ranges, cooldowns, attack/cast timing, splash/bounce/line
  damage parameters and projectile speed/homing.
- Heroes and tech: base attributes/growth/primary attribute, ability references,
  upgrade references, prerequisites/counts, trained/built/sold units, sold/created
  items, available research, building upgrades and revive settings.

The SDK payload drops models, textures, portraits, sound paths, colors, shadows,
selection circles, cosmetic animation settings, attachment/projectile visuals,
editor categories/labels/bounds/sorting, AI formation/priority/path-placement
settings, default hotkeys, random hero-name pools, long tooltips and source/debug
columns. Existing SDK icon lookup supplies icons. Precomputed spreadsheet DPS,
realHP and other derived columns are dropped because they can be stale and are
not live values; retain the inputs for explicit calculations. Attack backswing
and damage-point timings stay because they affect gameplay despite being related
to animation. Ability/item/upgrade definitions are not recursively duplicated.

All retained source values survive losslessly, including empty strings,
whitespace, numeric-looking strings, dash/underscore sentinels and absent fields.
Repeated column names, source names, strings and per-column defaults are stored
once. A storage default is a compression mechanism, not an inferred game default.
World Editor field definitions are useful for offline extraction and validation,
but are not emitted in this payload.

## Measured sizes

Bytes below are the JSON artifact sizes, excluding any future public loader.
Gzip uses level 9 and Brotli uses quality 11; these are transfer sizes only when
the server actually supplies the corresponding Content-Encoding.

| Artifact | JSON bytes | Gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| Basic stats: 864 unit records, 20 fields | 50,369 | 9,530 | 7,870 |
| Broader gameplay catalog: 865 IDs | **258,986** | **51,475** | **40,775** |

The gameplay representation is 94.1% smaller than the original raw JSON before
compression. The original also compresses (274,456 bytes with the original
Python gzip defaults), so compression savings must not be presented as all
coming from filtering. The basic projection duplicates a small subset of the
gameplay data intentionally, so simple consumers can avoid downloading it all.
The extra gameplay ID is nrmf, present only in the weapons sources; no balance
stats are fabricated for it.

The basic projection contains goldcost, lumbercost, fused, fmade, HP, manaN,
mana0, bldtm, isbldg, level, spd, def, regenHP, regenMana, STR, STRplus, AGI,
AGIplus, INT and INTplus. These are source column names and source strings,
not the proposed public property names/types. In particular, hero base HP is
not effective HP after strength and a missing value is not zero.

## Package and loading boundary

This reduced catalog is small enough for a dedicated optional SDK entry. Tie it
to a specific game build, keep it out of the SDK root/standard-game import graph,
and decode units as requested. Applications that only sort units can use the
small stats projection. Dynamic import can defer the broader gameplay catalog;
hosting an external multi-megabyte World Editor dump is no longer needed for the
chosen scope. Final module/loader overhead must be measured at runtime integration.

There is no public loader or hosted URL yet. The generator, tests and this note
are excluded by the SDK's existing npm files allowlist. An npm pack dry run
confirmed zero added package files. No runtime or deployment contract changes
are included in this preparation.

## Reproduce and verify

The compactor consumes the extraction prototype's schema version 1:

```sh
node scripts/unit-catalog/compact.mjs /path/to/unit-source-catalog.json /path/to/output
node --test test/unit-catalog-compaction.test.mjs
```

It writes unit-stats.json and unit-gameplay.json with gzip/Brotli
siblings, plus size-report.json. Each artifact includes the game build, selected
balance and input SHA-256. The report includes output hashes and all discarded
keys, including newly encountered unselected fields for patch-update review.
Before recording success, the generator decodes the serialized artifacts and
asserts deep equality against every selected source record. Unknown melee
balance-version qualifiers fail rather than silently selecting them.

Uncompressed/gzip budgets are 64/12 KiB for stats and 320/64 KiB for gameplay.
Generation fails on budget growth so future
patch updates need an explicit review instead of silently inflating the payload.

Installation extraction and patch orchestration are now automated by the
platform's `packages/warcraft-patch` toolchain, which calls this compactor and
pins source files, build identity and tool versions. Field type conversion,
localization and profile precedence remain separate integration work. This
compactor does not turn the source snapshot
into a fully resolved World Editor model, add missing source files, or apply
custom-map overrides. These size measurements cover the extracted prototype;
additional fields or loader/type-resolution overhead must be measured again as
that work is completed. The original full source dump remains an offline research
artifact, not part of the SDK payload.
