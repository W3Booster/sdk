# Migrating to SDK 3 (upcoming)

SDK 3.0.0 and protocol 3 are a coordinated breaking release. Do not point a
production SDK 2 app at the protocol 3 backend. Publish SDK 3, update the app's
registry dependency and lockfile, regenerate its database-owned binding, and
rebuild before switching the platform and app together.

| SDK 2 usage | SDK 3 replacement |
| --- | --- |
| Hero rawcode in `hero.id` | `hero.typeId`; `hero.id` is an opaque instance ID |
| Hero arrays / unit type counts | `player.heroes`, `player.units`, `player.buildings`: separate instance maps |
| A rawcode as a rendering key | `(match.id, entity.id)`; rawcodes can repeat or change on transformation |
| Legacy solo/team statistics and `preferredStats` | `player.stats.status`, `player.stats.records`, `statsForMode(player, mode, options)` |
| Cooldown `total`, `remaining`, `elapsed` | `totalSeconds`, `remainingSeconds`; derive elapsed if both are known |
| Research start/finish timestamps | `TimedProgress`; missing observations use null timers |

The maps contain observations, not authoritative army totals. Missing collections
mean unavailable; an observed empty map or production queue means empty. Queued
items have a type and a snapshot slot, not an already spawned unit instance ID.

`Unit.hitpoints` and hero `mana` expose `{ current, max }` in player-facing units.
Use the unit/building/hero selectors or `Object.values(collection ?? {})`.
Hero vitals use the fast hero update cadence; other health and hero positions
use 200 ms sampling. Structures retain their first observed position. Ordinary
units omit position. Updates are sent on change; don't create another polling
connection. Snapshots remain immutable.

`Building.production.queue` and `Building.construction` expose `progress`
(completed fraction 0–1), `totalSeconds`, and `remainingSeconds`. Unknown timers
are null, including waiting slots. They use game time: never advance through
pauses on a wall clock. Ability cooldown helpers use the same fields but remain
estimates from standard-game metadata and observed ability activation.

Request `units:read`, `buildings:read`, and `production:read` as needed.
Construction needs both buildings and production access. Production, hero data,
and research are PRO in self-play and free in observer/replay modes. Ordinary
unit/building observations in self-play cover the local player; observer/replay
observations cover non-neutral players. Opponent control groups are unavailable
in self-play. Always honor delivered capabilities and optional fields.

`player.stats` separates loading, ready, and unavailable. Each record identifies
its provider, mode, queue, and optional season/race/team. Use `statsForMode` with
an exact team ID for arranged teams; ambiguous selections return undefined.
`mmr`, rank, placement state, and league can be absent; never substitute zero.
Battle.net and W3Champions share this shape. `match.realm` identifies the game
service; `isReforged` only selects graphics. Battle.net division artwork is
available through `/assets` helpers, separate from W3Champions league IDs.
Apps do not receive WC3 socket credentials or fetch profiles themselves.

The terminal local-player result still uses `match.result`. The recorder latches
a valid victory observation, ignores failed/invalid reads, and otherwise reports
lost at self-play match end. This fallback is a product rule, not independently
confirmed defeat evidence. Observer/replay results remain absent. Apps must not
infer losses from an absent SDK result; deduplicate by match ID and own scoring
eligibility. A result may arrive after the first finished snapshot.

See [CHANGELOG.md](CHANGELOG.md) and [README.md](README.md) for the API examples.
