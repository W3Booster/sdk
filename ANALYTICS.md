# Player statistics and match history

Available in SDK 4.6. These optional fields require a matching recorder and platform deployment; handle their absence when connected to older clients.

In self-play, statistics, loss counters and outcomes are restricted to the actual
local player. Observer/replay matches may expose all participants. Existing grants
apply independently on the API and local-recorder paths. Missing means unavailable
or ungranted; zero and empty collections mean observed values.

| Field | Content | Grant |
| --- | --- | --- |
| `match.outcomes` | Explicit `won`, `lost`, `draw` by participant ID | `match:read` |
| `match.gameName` | Observed lobby name | `match:read` |
| `player.statistics` economy | Gross `goldMined`, `goldCredited`, `goldUpkeepLost`, `goldDiversionTax`, `lumberCredited`, `lumberUpkeepLost`, `lumberDiversionTax` | `resources:read` |
| `player.statistics` metadata | Native `handicapPercent`, `realTimeApm`, `slotState`, `aiDifficulty`, `racePreference`, `playerRace`, ten `timeInUpkeepMs` entries | `resources:read` |
| `player.statistics.items[typeId]` | Cumulative `collected`, `purchased`, `sold`, `used`, `destroyed`, `damageDealt`, `healingDone` | `heroes:read` |
| `player.statistics.heroes[instanceId]` | `typeId`, `level`, `nextLevelExperience`, deaths, total/hero/self/building kills, `timeAliveMs`, and abilities | `heroes:read` |
| `heroStatistics.abilities[typeId]` | Damage/healing, learned level, native hero classification and an observed active `cooldown` timer | `heroes:read` |
| `player.statistics.units[typeId]` | `currentAmount`, `totalAmount`, `isPeon`, `isFunctionalPeon`, damage dealt/received and healing | `units:read` |
| `player.losses.units` / `.buildings` | Sampled deaths by type, game time and completeness | `units:read` / `buildings:read` |
| `poi.ownerSlot` | Native owner slot, including neutral slots 24–27 | `pois:read` |

Existing hero, inventory, resource, research, building and POI snapshots remain
canonical for their live values. Resolve names, icons, configured ability cooldowns,
item levels, upgrade maximum levels and standard stock limits through the exact
`match.gameDataId` catalog. These definitions describe the standard ruleset;
custom-map overrides must not be presented as measured standard catalog values.

Item statistics expose only native keys representable as four-character item IDs.
Internal numeric damage keys are omitted, never attributed to a guessed item. An
unreadable item table omits `items` without withdrawing independently read economy.

`goldMined` is the gross JASS score: credited gold plus upkeep loss. Resource totals
are actual resource units. The engine also increments `destroyed` when an item's
last charge is consumed; destruction is diagnostic and must not add a second loss.
A sale is a distinct native event, never inferred from an empty inventory slot.

Hero IDs preserve full instance identity. Ability timers use `TimedProgress` and
are omitted when inactive or unreadable. Ability classification uses loaded native
data, including available instance overrides. `timeAliveMs` uses the engine's
wall clock, so replay pause/speed affects its relation to match time. Upkeep tier
length and timing likewise preserve engine semantics.

Unit `totalAmount` counts retained engine instances, including corpses. It is not
an ever-trained counter. Unit-type damage/healing sums those retained instances
and can decrease when corpses disappear. `isFunctionalPeon` is Warcraft's worker
predicate, not an idle-worker estimate.

Unit/building death counters count observed alive-to-dead transitions. They ignore heroes,
illusions, transfers, type changes and unreadable/disappearing instances. They
currently carry `complete: false`: attachment time and sampling can miss deaths.

Outcomes use explicit native results only. Leaving a replay, closing Warcraft or
a player departure never implies a winner. Rewinds reset observations; known
results survive the terminal snapshot. The existing own-player `match.result`
contract is preserved.

## Graphs and rolling loss windows

The optional `@w3booster/sdk/analytics` entry has no transport, timer, or persistence.
Push each state from your existing subscription. Reset the history on a disconnect
or known delivery gap; it automatically resets on match, mode, scope, catalog, or
backward-clock changes. Initial counters establish a baseline: they do not invent
past event timestamps. New consumers collect their own history.

```ts
import { createMatchHistory } from '@w3booster/sdk/analytics';
import { loadGameData } from '@w3booster/sdk/game-data';

const history = createMatchHistory();
// In the app's existing state callback:
history.push(state);
const goldGraph = history.economy(playerId); // gameTime, goldMined, goldUpkeepLost, netGold
const catalog = await loadGameData(state.match.gameDataId!);
const lastFight = history.window(playerId, 30, catalog); // also accepts 60, etc.
// lastFight.counts, .events, .cost.gold/.lumber/.food
```

Use the exact catalog revision named by this match; mismatched catalogs are
rejected. Costs are standard-melee estimates, not actual measured expenditures;
custom maps can override them. Missing cost data yields `null` instead of zero.
Item-use costs are apportioned across the catalog's starting charges. Sold-item
costs require an explicit `soldItemRefundRate` (for example, `0.5` if that is your
ruleset), and use purchase price minus proceeds. Never label every missing item
as sold or consumed. Filter with `kinds` to choose which loss categories to show.

Hero death-counter increases produce `hero-lost` events under `heroes:read` and
the existing self-play ownership rules. Events include the full `heroId` instance
identity; `counts['hero-lost']` aggregates deaths by hero type. Reviving and dying
again can produce another event for the same hero. These events are included in
the default window, or select only them with `{ kinds: ['hero-lost'] }`.
Hero deaths are excluded from **all** cost totals: neither recruitment cost nor
revival cost is charged, and a hero-only window has zero estimated cost. This
does not mean revival is free; its actual cost is not observed.

Each newly observed hero establishes its own baseline, including after a transfer
or disappearance. Existing lifetime deaths are never backfilled. Missing/stale
statistics break coverage; counter regressions invalidate that hero's retained
events. Hero-only completeness refers to continuously observed native counters,
not exact death timestamps. Requesting hero history without hero statistics makes
coverage unavailable; consumers wanting only ordinary losses can explicitly
select `unit-lost` and `building-lost`.

Each event has a `(fromGameTime, gameTime]` observation interval. `boundaryUncertain`
means an event's interval straddles the selected window start. `covered` means the
window is retained and observed for every requested category; it does not promise
complete death detection. Check `complete` separately. Use those flags in the app
when presenting partial comparisons.

Economy history contains the current contiguous observed segment. Missing or
invalid gold/upkeep clears that player's series immediately. Freshness uses
optional `match.gameSpeed`, the recorder's measured simulation rate, to scale the
five-game-second tolerance during replays. A one-second recent-rate allowance
handles speed transitions and transient zero readings; an existing observation
retains its speed allowance until replaced. Without observed speed, the original
five-game-second tolerance applies. Live self-play/observer history keeps that
same tolerance.

A timestamp that stops advancing still expires after five **unpaused real
seconds**, regardless of speed. New data after that delivery gap starts a fresh
segment and fresh loss-counter baselines. Unrelated updates or counter changes
at the same timestamp cannot refresh the deadline. Pause and finished states do
not age observations; disconnect/gap callbacks must still call `reset()`.
The same freshness rules apply to item, hero, unit and building loss counters.

History uses `performance.now()` without starting timers. For offline processing,
provide `createMatchHistory({ now: () => recordedReceiptMilliseconds })` and
advance that monotonic clock before each `push`. Preserve the snapshot's observed
`gameSpeed`; do not infer it from how quickly an offline loop executes.

An empty series means unavailable, not zero income. Compare players at matching
sample times, never subtract arbitrarily old last points from a current sample.
Maximum-speed replay observations are sparse: plotting at their actual game times
is supported, but connecting the points estimates unobserved values and cannot
recover missed events. The SDK does not fabricate intermediate gold samples.

Default retention is 7,200 game seconds, 15,000 economy samples per player, and
20,000 loss events total. Limits are configurable and bounded. Missing feeds reset
counter baselines so reconnects do not manufacture events during a gap. Call
`reset()` when disposing the app session. Returned arrays, events, and summaries
are immutable. Scoreboard persistence and one-point-per-map deduplication remain
app policy; deduplicate using the match ID and account for replay seeks.


Production entries additionally expose optional `buildType`: `research`, `unit`,
or `reviving`, under the existing production permission. Revival classification
uses the native queue's full unit reference; ordinary categories use the exact
match catalog. Unknown or stale references omit the kind. Progress and timers
retain their existing semantics, including cancellation and restart.
