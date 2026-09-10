# Migrating to SDK 3

SDK 3 adds production queues, construction timers, unit health, hero mana, and
MMR for Battle.net and W3Champions. This guide covers the breaking changes and
how to use the new data in your app.

## Upgrade your app

1. Update `@w3booster/sdk` to version 3 and update your lockfile.
2. Regenerate your app binding after updating its requested scopes.
3. Apply the model changes below, then rebuild and redeploy your app.

SDK 3 requires platform protocol 3. An SDK 2 bundle cannot connect to that
platform; upgrading the package without rebuilding the bundle is not enough.

## Entity identity and collections

| SDK 2 usage | SDK 3 replacement |
| --- | --- |
| Hero rawcode in `hero.id` | `hero.typeId`; `hero.id` is an opaque instance ID |
| Hero arrays | `player.heroes` is an instance map; units and buildings have their own maps |
| `hero.name` / required `hero.level` | Display text comes from app metadata keyed by `typeId`; level is optional until observed |
| `modeInfo(mode).stats` | `modeInfo(mode).ladderMode` identifies the exact ladder mode |
| A rawcode as a rendering key | `(match.id, entity.id)`; rawcodes can repeat or change on transformation |
| Legacy solo/team statistics and `preferredStats` | `player.stats.status`, `player.stats.records`, `statsForMode(player, mode, options)` |
| Cooldown `total`, `remaining`, `elapsed` | `totalSeconds`, `remainingSeconds`; derive elapsed if both are known |
| Research start/finish timestamps | `TimedProgress`; missing observations use null timers |

The maps contain observations, not authoritative army totals. Missing collections
mean unavailable; an observed empty map or production queue means empty. Queued
items have a type and a snapshot slot, not an already spawned unit instance ID.

## Health, mana, and positions

`Unit.hitpoints` and hero `mana` expose `{ current, max }` in player-facing units.
Use the unit/building/hero selectors or `Object.values(collection ?? {})`.
Hero vitals use the fast hero update cadence; other health and hero positions
use 200 ms sampling. Structures retain their first observed position. Ordinary
units omit position. Updates are sent on change; don't create another polling
connection. Snapshots remain immutable.

## Production and countdowns

`Building.production.queue` and `Building.construction` expose `progress`
(completed fraction 0–1), `totalSeconds`, and `remainingSeconds`. Unknown timers
are null, including waiting slots. They use game time: never advance through
pauses on a wall clock. Ability cooldown helpers use the same fields but remain
estimates from standard-game metadata and observed ability activation.

## Scopes and visibility

Request `units:read`, `buildings:read`, and `production:read` as needed.
Construction needs both buildings and production access. Production, hero data,
and research are PRO in self-play and free in observer/replay modes. Ordinary
unit/building observations in self-play cover the local player; observer/replay
observations cover non-neutral players. Opponent control groups are unavailable
in self-play. Always honor delivered capabilities and optional fields.

## MMR, ranks, and loading states

`player.stats` separates loading, ready, and unavailable. Each record identifies
its provider, mode, queue, and optional season/race/team. Use `statsForMode` with
an exact team ID for arranged teams; ambiguous selections return undefined.
`mmr`, rank, placement state, and league can be absent; never substitute zero.
Battle.net and W3Champions share this shape. `match.realm` identifies the game
service; `isReforged` only selects graphics. Battle.net division artwork is
available through `/assets` helpers, separate from W3Champions league IDs.
Use the delivered statistics; your app does not need a separate profile integration.

## Match results

Read the terminal local-player result from `match.result`. It can arrive after
the first finished snapshot. Deduplicate by match ID before updating a score;
your app still decides which matches count.

Observer and replay results are absent. An absent result is unknown, not a loss.
For self-play, the platform reports a recorded victory as won and otherwise
reports lost when the match ends; a loss is not independent defeat confirmation.

See [CHANGELOG.md](CHANGELOG.md) and [README.md](README.md) for the API examples.
