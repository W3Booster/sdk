# SDK architecture decisions

## 2026-09-24: Analytics freshness follows observed replay speed

Actual 64× captures reproduce 16 and 36 history clears despite complete paired
gold observations. Supersede the fixed-five-game-second policy for accelerated
replay history. Expose optional public `Match.gameSpeed` from the existing fresh
simulation clock: measured game seconds per real second, 0..64, zero when paused
or finished and absent with an unavailable/stale clock. This derived gameplay
value is public; raw clock domains, anchors and sequence IDs remain private.
No native/API wire change or production deployment is part of this repair.

Scale the existing five-second game-clock tolerance by measured replay speed,
with a one-second recent-rate maximum for transitions/zero-rate jitter. Carry a
sample's allowance until replacement, but cap frozen timestamps at five active
real seconds. Missing/invalid fields still clear immediately; no sample received
after a silent gap may backfill the gap. All loss lanes use the same freshness
policy. Plain snapshots without speed retain the old game-clock tolerance.
`MatchHistoryOptions.now` injects monotonic receipt time for offline processing;
default to performance.now without adding a timer. Pause/finish suspend aging.

Also revisit September 18's zero-rate display reset: the Sok–Lyn capture contains
a forward heartbeat with rate zero that made the integer display move backward
and falsely reset history. Hold the integer display across zero-rate readings
while unpaused; observed precise rewinds, sample restart, explicit pause, finish,
source/match changes and gaps still rebase. Do not hold pool/progress corrections.
Sanitized captured regressions require retaining all 62/81 observed gold pairs;
separate tests preserve outage, frozen-opponent, permission and rewind behavior.

## 2026-09-24: Include hero deaths in optional loss history

At the user's request, extend the locally computed loss-kind union and default
history window with `hero-lost`. Use existing authorized native hero death
counters, keyed by full instance ID, and expose `heroId` on each hero event.
Aggregate counts by type without mixing same-type instances or owners. New and
returning instances establish baselines; missing data never implies a death.
Preserve observation intervals, bounded retention, resets and scope/self-play
gates. A counter regression invalidates only that hero's events and coverage.

Exclude hero events from gold, lumber and food cost estimates: recruitment price
is not death/revival expenditure. Document zero hero-only estimates as excluded
costs, not free revival. Default coverage now also requires hero statistics;
callers can explicitly select the existing kinds to retain the previous lanes.
This SDK upgrade adds a local output enum member; it does not change the wire
protocol. Existing deployed SDKs keep their existing behavior. No native,
API or Match Vision UI change, publication or deployment is part of this work.

## 2026-09-18: Stabilize integer clock presentation across heartbeat corrections

Production observation found three brief backward integer-clock ticks (36–51 ms)
while server game time continued forward. A new heartbeat can place the precise
estimate just below a second already displayed by extrapolation. Retain the last
displayed integer during forward-moving, running observations until the estimate
catches up. Apply this only to `match.gameTime`; pool/progress calculation and the
authoritative transport patch baseline must never use the retained display time.

Compare successive observed precise clocks, not the estimated display, to detect
backward seeks. Clear the hold on any observed rewind or sample-sequence restart,
pause/zero clock rate, status change, missing clock, match/source change and the
existing gap/disconnect resets. This allows true corrections and subsecond seeks;
do not promise monotonic time across these boundaries. Keep the 200 ms wire
heartbeat, 50 ms projection and one-second freshness bound unchanged.

Deterministic correction and speed-switch regressions fail against SDK 4.4.0 and
pass with the correction. Tests also cover independent pool/progress correction,
pause/end, rewind, source/match changes, stale data and real client patch/gap/
reconnect handling. The synthetic correction durations model the observed flicker;
they are not a replay of captured precise heartbeat payloads. This change is local
preparation; publication and consumer deployment require separate authorization.

## 2026-09-17: Declarative in-game input regions

The optional overlay-input entry owns framework-neutral DOM region tracking and
local parent-frame messages. Updated client creation loads it only for compositor
launches carrying w3input=1. `.w3-interactive` defaults to blocking a rectangular
region; conditional routing consumes at pointer/mouse-down, never retroactively
at click. The compositor authenticates source/origin/document tokens; native
window routing stays in the desktop main process. Region geometry and input never
travel through match data or backend transports. Stale regions expire to preserve
gameplay availability; queued old input must not replay after renderer recovery.
This is local implementation, not a published host capability. See [OVERLAY_INPUT.md](OVERLAY_INPUT.md).

## 2026-09-11: Current gameplay configuration and bounded optional data

The user wants current melee unit-type configuration and explicitly authorizes
dropping World Editor fields unlikely to serve SDK use cases. Keep economy,
base stats, combat, hero attributes, abilities, tech relationships and identity.
Drop legacy balance, editor metadata, cosmetic assets/settings, long tooltips,
AI/editor placement controls and derived/debug spreadsheet columns. Preserve
current unit types rather than hand-maintaining a list of popular ladder units.
UNIT_CATALOG.md and the extraction policy record the detailed selection.

Store repeated source keys, values and defaults once, preserving missing values
and sentinels exactly. The resulting gameplay catalog is small enough for an
optional SDK entry; a smaller stats projection can support costs/supply/HP alone.
Neither belongs in the eager SDK core. Pin the game build and avoid eagerly
expanding every unit's full record. Keep the original full source dump offline
for regeneration and audits; there is no requirement to ship every editor field
or add a hosted full-data asset for the narrowed scope.

UNIT_CATALOG.md records measured compact artifacts, regeneration, lossless
round-trip checks and size budgets. This is preparation only: the source
snapshot is not a resolved World Editor model, and no runtime loader, hosted
asset, public API or deployment is introduced by the compaction work.

## 2026-09-10: Provider MMR and Battle.net league artwork

Expose optional finite `PlayerStats.mmr` consistently with the shared platform
stats DTO. Preserve the provider value; never substitute level, rank, or zero
when unavailable. W3Champions already returns `mmr`; its service explicitly
preserves finite values and caches by realm, player, race and current season so
one race/season cannot supply another's rating. The existing `match.realm`
identifies the recorder realm (Reforged, W3Champions and regional variants).
It is independent of `isReforged`, which selects graphics. No second realm field
or new network fetch in the browser SDK is introduced.

Original Battle.net division badges live in the versioned static catalog
`assets/wc3/bnet-leagues/v1`. The SDK assets entry supplies URL/manifest helpers;
the npm package contains no artwork. Division IDs 0–7 follow the game UI's
localization array, not W3Champions league IDs. The compact variant defaults to
the original simplified artwork, with the standard badge for unplaced (0).
Unknown division values return no URL. No MMR thresholds are hardcoded. Retain
original bytes, provenance, dimensions and hashes; artwork is not SDK MIT code.
This adds stats/assets support only; reliable local Battle.net fetching and
AT/RT attribution remain separate unfinished work. Nothing is published here.




## 2026-09-09: Production follows the existing PRO data entitlement

Production and construction are PRO during self-play and free while observing or
watching replays. The API withdraws production capability for free self-play;
construction requires both buildings and production capabilities in the API and
SDK recorder projection. Native readers enforce the same rule before paid reads
and publication, including hero pools. Ordinary building health stays free.
Match Vision's player construction/queue settings are PRO, while observer/replay
hero, research and production settings remain free as in the legacy client.
Custom observer headlines remain PRO. Schema metadata, not app-side duplicate
plan checks, controls settings access.

## 2026-09-09: Unify timed progress before SDK 3 release

The user explicitly permits another breaking change across the unreleased stack.
`TimedProgress` defines required progress, remainingSeconds, and totalSeconds for
production slots, construction, researching upgrades, and derived ability
cooldowns. Progress is the completed fraction 0..1 or null; timers must be both
null or finite with total > 0 and 0 <= remaining <= total. Missing timing fields
are rejected for observations rather than supported as an older sender shape.
This supersedes the optional timer compatibility wording below.

Cooldown helpers remove total/remaining/elapsed names; calculate elapsed from the
new pair. They still derive standard-game estimates from the observed activation
and game clock. Construction timers are authoritative engine observations from
the existing real-property read. Research no longer exposes start/finish wall
clock dates: the current recorder cannot observe an active research countdown,
so no durations are invented. Unknown fields remain null. All activities preserve
game pauses/speed and introduce no wall-clock ticker or extra native reads.


## 2026-09-09: Instance-based player collections (SDK/protocol 3)

Accepted at the user's explicit request to permit breaking changes before SDK
adoption. This revisits ADR-011's installed-consumer assumption for this major;
additive compatibility remains required within protocol 3.

Expose mutually exclusive player.units, player.heroes, and player.buildings maps
keyed by the full match-scoped engine ID. Every instance uses id for identity and
typeId for its actual rawcode. Hero extends Unit; Building extends Unit. Do not
retain a parallel rawcode-keyed public hero model. Hero XP and levels are optional
until observed; never invent level 1 when only a health message has arrived.
Selectors expose immutable arrays with structural sharing. Hero semantic event
IDs and renderer keys now identify instances, while icon lookup uses typeId.

Native health and production are independent observations joined by instance ID.
Invalidating one removes only its fields, not unrelated observations. Ownership
and category changes remove prior membership. Queue positions are snapshot
coordinates, not persistent jobs; progress uses 0..1 or null, construction is
separate, and unknown data is never fabricated. The active queue slot reports
its observed timer fraction; waiting slots report zero. Additive
`remainingSeconds?: number | null` and `totalSeconds?: number | null` carry
the active slot's observed game-time countdown and initialized duration. Waiting/unstarted/unreadable timers are null (older senders may omit
them), never inferred from rawcode training times or percentages. Values must be
finite and can only be supplied for slot zero; total is positive and remaining
is nonnegative and no greater than total. Consumers may derive elapsed seconds
or percentages from the pair; the delivered progress remains a convenience. The SDK forwards
the timer without a wall-clock countdown, preserving game pause/speed semantics. Construction comes from
the building's ABnP component, independently of health, and is omitted when no
construction component is observed. Unreadable progress is null. Building
upgrades are a separate activity and are not represented as construction.

Heroes publish position changes on the 200 ms native cycle. Structures expose
the first successfully observed position for their instance; even a transient
health read failure must not cause it to be resampled. Ordinary units omit
position. The SDK forwards this observation policy and adds no polling.
Scope gates are identical for
server and recorder paths, including the existing hero entitlement.

The private workspace datamodel authors the server's protocol 3 unit DTOs; the
standalone public SDK mirrors these types without a private-package dependency.
The API can build before SDK 3 is published using unchanged SDK types for other
fields and explicit protocol 3 player DTOs. Verify both projections with
`node apps/api/scripts/verify-unit-sdk-contract.cjs` in the platform workspace;
SDK_ROOT may select an unpacked SDK artifact. Do not fake a registry dependency
on an unpublished version or equate local checks with publication.

CE derives the utar virtual getter and target-mask field; no unit field offsets
are hand-maintained. The SDK does not read process memory or add polling loops.
The existing Match Vision consumer needs its SDK 3 migration/packed consumer lane
before a coordinated release; breaking this major does not silently make SDK 2
applications compatible. No deployment or merge is part of this change.


## 2026-09-08: Classify network errors at the HTTP boundary

Fetch and response-body TypeErrors represent network failures and stay retryable
through aggregate ConnectionErrors. Preserve their causes for diagnostics.
Classify them only at the network boundary: SDK argument TypeErrors, credential
provider errors, invalid JSON, and permission failures retain their permanent
classification. Both composition watches and broker match-data connections
must recover after repeated browser fetch failures without a page reload.

## 2026-09-08: Recorder hero caches preserve first appearance and item slots

Hero updates replace cached values without reinserting their key, both within
one pending frame and across accepted frames. Replaying the cache over a platform
snapshot must not reorder heroes by their latest inventory/experience update.
Use the normalized hero identity for the key so transformed forms replace the
same hero instead of replaying stale inventories from a second cache entry.
Clear this order with the existing match/transport cache lifecycle. Other update
classes retain chronological reinsertion, including player-slot selection.

Inventories retain native slot order exactly, including empty strings and
duplicate rawcodes. New inventory data replaces the slot array; it is never
sorted, filtered, or treated as a set. This is transport correctness shared by
every consumer, not a Match Vision sorting workaround.

Broker resynchronization is coalesced to at most one request per second. The
first request is immediate; repeated requests retain one delayed retry, canceled
on close. This bounds repeated invalid snapshots without dropping the ability
to recover when valid state returns. API and local-recorder hero abilities omit
non-positive or non-finite activation timestamps instead of publishing native
unused-ability sentinels into the validated SDK state.

## ADR-011: Keep installed SDKs stable across additive API changes

Status: accepted, 2026-09-07; clarifies the scope of the prerelease cleanup.

Retiring protocol 1 and prerelease aliases does not prohibit forward compatibility
inside protocol 2. Existing SDKs accept safe additional state attributes and later
minor protocol versions. Preserve unknown fields through snapshots and patches,
without interpreting them, so subsequent patch paths remain valid. Keep private
transport data hidden and continue validating known fields and unsafe JSON keys.

Do not change an existing type, required field, meaning, or closed enum under the
label of an additive API change. Such changes need a documented version transition
or explicit negotiation. New SDK releases may add optional types/helpers without
forcing apps that consume only existing fields to upgrade. Generated app-definition
revisions remain a separate contract. The compatibility test suite exercises these
rules through the public client; no runtime alias or legacy-data fallback is needed.

## ADR-010: Recorder outcomes extend the existing match state

Status: accepted, 2026-09-05.

`Match.result` optionally identifies the actual local player and its `won` or
`lost` outcome. Unknown results, observer slots and replays leave it absent. The
API consumes native W3GameResult facts and retains terminal state until the next
match. Existing SDK state subscriptions and initial-finished lifecycle hydration
carry this information; there is no separate app-specific result transport.

The SDK validates and freezes the optional result, but does not turn it into
session wins/losses or decide which games an app counts. Generic application
storage may be accessed through the existing host command primitive; schemas,
retention, automatic resets and scoring remain consuming-app policy. SDK 1.1's
existing safe-field preservation accepts the additive wire field, so consumers
that validate it can run against that registry release while the new type and
validation await publication.

## 2026-09-05: One prerelease runtime contract; retain release preparation

Status: accepted; supersedes earlier promises to preserve development SDK aliases.

The platform has not launched. SDK 2 and protocol 2 use one current contract:
required `gameContext`, private `transport.recorderUrls`, explicit host capability
discovery, and parser-validated typed commands. App-owned score stays in application
data. Removed scopes, methods, state shapes, and launcher implementations must fail
explicitly instead of being inferred or silently converted. Deploy platform, SDK,
and apps together; package versioning records the breaking change, not a promise
to support older development builds concurrently.

Keep seeding, bootstrap, catalog preparation/reapply, grant synchronization,
release preflight checks, purchase-history migrations, and immutable release assets.
The v2.0 release must migrate pre-2.0 production data, including user settings,
grants, purchases, and entitlements. Migration support is not obsolete runtime
compatibility. One-time data preparation belongs in those tools, not ordinary runtime reads.
Current browser/game support, reconnects, missing-data handling, and corruption
protection remain required behavior.


This file prevents repeated reviews from oscillating between equally plausible designs. These decisions are not immutable: change one when constraints have changed or new evidence invalidates an assumption. A change should update this file with the reason and migration path. Reviewers should still report bugs or violations of a decision, but should not report the documented tradeoff itself as a new finding without explaining the new evidence.

## ADR-009: Unscoped game context and app-owned runtime data

Status: accepted, 2026-09-05.

The platform contract now distinguishes shared game context from app data. gameContext is always normalized onto delivered state, including no-scope and idle snapshots, with hudScale defaulting to 1. Optional boolean context stays unknown when absent. Local recorder updates modify this branch without an overlay capability check; resource/hero/etc. gates remain unchanged.

ApplicationState.data is a generic read-only JSON record. Match Vision’s score is delivered there by the platform only to that app; the SDK does not implement application identity or scoring policy. Existing overlay:read bindings and runtime/score helpers remain deprecated compatibility interfaces. Overlay normalization remains allowlisted and gameContext never absorbs score, legacy settings or recorder URLs. MatchState keeps the additive field optional in its source type to accept older wire fixtures; current runtime delivery always includes it. Revisit ADR-008’s scope-dependent runtime assumption with this explicit replacement.

## ADR-001: Keep the core framework-neutral

Status: accepted, 2026-08-19.

The SDK exposes immutable snapshots, immediate stores, subscriptions, `AbortSignal`, and plain ESM functions. It does not import Angular, React, Vue, Svelte, or their lifecycle/DI systems. A dependency-free framework-named adapter is allowed when it implements a framework-owned standard contract; `@w3booster/sdk/react` is the example.

Application UI state, localization, dependency injection, component lifecycle, persistence policy, optimistic feedback, CSS/layout policy, and app-specific settings precedence stay in the application. Protocol semantics, transport, security/privacy, lifecycle, Warcraft III rules, and genuinely repeated cross-application presentation primitives belong in the SDK.

Revisit only if at least two consumers cannot integrate safely through the framework-neutral contracts.

## ADR-002: Generate the public API, check the JavaScript runtime

Status: accepted, 2026-08-19.

Contracts under `api-source/` are the source of truth for public types and value signatures for the six contract-backed core entries (`.`, `app`, `assets`, `selectors`, `standard-game`, and `store`); matching `src/*.runtime.js` modules own implementation, and `api-source/version.ts` owns version literals. Their forwarding facade sources are generated automatically from exported contract values, so contributors do not maintain a third export list. The other published entries remain directly authored JavaScript/declaration pairs and are guarded by strict runtime checking, declaration-surface tests, and packed-consumer tests; they are not claimed to be generated. Generated facade/declaration files are committed package artifacts and must not be hand-edited. `npm run check:api` must fail on stale generated source or package output, and generated runtime namespaces have compile-time assignability checks against the public namespaces.

Runtime modules remain JavaScript for this release. `npm run check:runtime` uses TypeScript `checkJs`, `strict: true`, and covers every public runtime entry point plus its imported graph. `noImplicitAny` is deliberately disabled as an incremental boundary; enabling it requires adding useful JSDoc or converting modules to TypeScript, not blanket suppressions. Do not return to independently hand-maintained public `.js`/`.d.ts` files or disable strict checking.

The seven directly authored entries (`compositor`, `settings`, `testing`, `react`, objects, icons, and cooldowns) additionally run inferred implementation-to-declaration namespace assignability checks from isolated runtime copies. Export-name parity alone is insufficient because it cannot detect parameter or returned-shape drift. A new directly authored entry must join that gate or move under generated contracts.

Settings and overlay-extension models are JSON-compatible root records. Arrays remain valid as nested JSON values but are rejected as explicit root models at every client, generated-application, and testing call site, matching runtime plain-object validation.

Revisit the JavaScript choice when a planned migration can preserve package output, browser compatibility, and reviewable diffs.

## ADR-003: Make generated application runtimes canonical without deleting advanced APIs

Status: accepted, 2026-08-19.

Generated `w3boosterApp.createRuntime()` plus its atomic lifecycle store is the primary frontend path. Low-level `createClient`, `openClient`, and related client/store methods remain supported as advanced and compatibility APIs. Documentation should lead with the generated runtime and move lower-level construction later; it should not repeatedly rename or remove lifecycle methods outside a planned major migration.

That canonical generated-runtime path supports both TypeScript and plain ESM applications. TypeScript is the default and includes exact settings aliases; an output ending in `.js`, `.mjs`, or `.jsx` contains the same definition revision, scopes, defaults, and `w3boosterApp` runtime binding without TypeScript-only syntax.

The runtime exposes its read-only lifetime `AbortSignal`. Client event subscriptions and other runtime-owned frontend work should use that signal so `runtime.stop()` is the complete teardown boundary. SDK 1 consumers may feature-detect the signal and retain a temporary explicit unsubscribe fallback.

The runtime lifecycle is an atomic aggregate of client lifecycle, resolved settings, and host lifecycle. Client teardown changes the underlying client and host stores synchronously but separately; the aggregate batches that paired terminal transition and never publishes either half-updated combination. Standalone connected clients with an unavailable host remain valid and are not hidden.

`open()` means a transport is open, `whenReady()` may use preserved state, and `whenSynchronized()` means fresh complete state is renderable. `connect()` remains a deprecated alias.

Initial connection retry remains the `connecting` status; `reconnecting` is reserved for recovery after a transport was established. The atomic client and generated-runtime lifecycle snapshots expose a nullable retry detail with the next/current attempt, configured limit, next delay, and last transient error. Frontends should use that structured detail instead of parsing errors or inventing a second retry loop.

Each generated-runtime `start({ timeout })` timeout bounds that caller's complete wait across transport opening, initial retry backoff, and the requested readiness milestone. It does not cancel the runtime's shared startup because another caller may still be waiting without that bound. Once a runtime is stopped, new lifecycle subscriptions are rejected rather than retained against a terminal store that cannot publish again.

Initial lifecycle hydration reports an active match by default. History and audit consumers may opt into the current finished match with `includeCurrentFinished`; it is emitted once as an initial ended observation. This is additive and opt-in so ordinary transition consumers do not mistake a hydrated terminal baseline for a newly observed transition. Persistence and retention remain application policy.

## ADR-004: Preserve immutable identity and contain consumer failures

Status: accepted, 2026-08-19.

SDK stores publish immediately on subscription, use immutable structurally shared snapshots, support abort-scoped subscriptions, and lazily subscribe derived stores to their source. Selectors and equality functions may fail without corrupting the store: the error is routed through `onError`, the last valid selection is retained, and later valid updates can recover. Subscriber failures never block other subscribers. A selector that fails during initial construction is reported and rethrown because no valid value exists.

Memoized collection results must be immutable through the runtime surface, not merely typed read-only. Cooldown indexes use a frozen `ReadonlyMap` facade over an inaccessible private native `Map`; they do not subclass `Map`, because `Map.prototype.set.call(subclass, ...)` bypasses overridden mutators and can corrupt a cached value shared across consumers.

If an eager source emits its current value and then a real change synchronously while subscription is being established, a selector-store subscriber receives the latest selected value exactly once. The final immediate delivery must not duplicate that synchronous publication.

Only the single eager callback establishing a source subscription may be suppressed. Later source notifications must re-run the selector even when the source snapshot has identical object identity: `client.state` intentionally uses such notifications for synchronization-freshness changes while preserving immutable state identity.

Because derived stores unsubscribe lazily while idle, restarting the source subscription also forces one derivation even when the eager source snapshot has the same identity. This recovers freshness metadata that may have changed while no derived listener was present.

React adapters suppress only an eager callback containing the same snapshot captured before subscription. A genuine synchronous change during subscription must notify React.

Abort ownership is installed before lazy source startup. If a subscriber aborts from a genuine synchronous startup publication, it is removed immediately and the source teardown runs after `source.subscribe()` returns it; later source values must not reach that subscriber.

## ADR-005: Validate host boundaries and serialize settings mutations globally

Status: accepted, 2026-08-19.

All setting mutations share one SDK queue. This preserves caller order for identical, parent, child, and unrelated setting paths; per-path queues are insufficient because `observer` and `observer.layout` overlap. App-owned optimistic UI may additionally serialize its own intent while supporting the published SDK 1 contract.

New generic host-command code uses an explicit parser before receiving a typed result. SDK 1.0.2 retains the deprecated generic typed overload for source compatibility, even though it cannot validate the acknowledgement at runtime; remove that overload only in a future intentional major.

Automatic capability discovery is tolerant so older hosts do not create unhandled failures. Explicit public `refreshCapabilities()` rejects timeouts, invalid responses, and host failures after moving capability state to a safe non-enabled status. Do not make the public operation silently tolerant again.

Compositor child launch URLs are a credential-bearing trust boundary because launch credentials can be placed in their fragments. They require HTTPS for remote hosts, permit HTTP only for exact loopback hosts, and reject URL user information. Apply the same policy as backend, WebSocket, and asset origins rather than accepting arbitrary HTTP(S).

An initiating per-call `open()` cancellation leaves the client in `closed`, with null unsynchronized state. This normalization applies even if a custom or testing transport reports `connected` before its `open()` promise settles; only the still-current connection generation may change the lifecycle, so cancellation cannot overwrite a newer attempt. Explicit `refreshCapabilities()` without an authenticated host rejects `HOST_UNAVAILABLE`, while the private automatic discovery path remains tolerant.

## ADR-006: Treat compatibility and publication as separate facts

Status: accepted, 2026-08-19.

The current SDK tree is released through the registry as SDK 1.0.2. A sibling symlink or packed checkout is useful for cross-repository development but is not evidence that normal consumers can install a change. Match Vision raises its declared registry minimum only after the matching npm artifact is visible.

After publication, upgrade consumers and remove obsolete pre-1.0.2 compatibility branches in one coordinated change. Do not alternately bump and roll back consumer ranges based only on the local symlink.

Compatibility is checked from both directions: Match Vision CI tests its registry minimum plus packed SDK HEAD, and SDK CI packs the current SDK checkout into a fresh canonical Match Vision checkout. An SDK pull request must not rely on an app-only workflow trigger to detect primary-consumer breakage.

Legacy `localApi` and `cloudApi` options are deprecated in favor of `backend` and `backendUrl`, but remain for SDK 1 configuration compatibility. Removal requires a future intentional major migration.

## ADR-007: Promote reusable primitives, not Match Vision policy

Status: accepted, 2026-08-19.

The SDK owns the shared primitives revealed by Match Vision: complete head-to-head tuple selection, canonical mode-aware team ordering for player, observer/replay, team, and FFA surfaces, launch-aware icon and country-flag resolution, player display identity, lifecycle observation, resolved settings, cooldown/resource/stat derivation, and globally ordered host settings writes. `orderMatchTeams()` uses explicit match mode before visible player count, so partial 2v2/FFA snapshots are not mistaken for 1v1; player and team-observer views are broadcaster-first, while observer/replay 1v1 uses map position. Explicit team mode remains broadcaster-first even when incomplete or malformed scoped data exposes other than two visible groups; group count must not override known mode semantics.

Match Vision keeps username/nationality overrides, player/observer profile precedence, match-scoped reverse-order persistence, local history retention, localized race/status text, sprite geometry, avatar-cover calculations, optimistic controls, and Angular signal/DI wiring. Small wrappers around SDK calls are allowed when they form an app-domain boundary; their existence alone does not justify another SDK API.

Promote more app code only after a second consumer demonstrates the same semantics or the behavior is required by protocol/security correctness.

## ADR-008: Normalize mixed and incomplete input safely

Status: accepted, 2026-08-19.

Modern `overlay.runtime` and legacy `overlay.misc` may coexist; normalize the documented public runtime fields from both, with modern values winning. Runtime normalization is an allowlist (`chatbarOpen`, `hudScale`, `matchScore`, and `teamColors`), not an object spread: `overlay.misc` is a platform/control-plane branch, and unknown modern runtime fields likewise require a public contract decision before exposure. Legacy score scalars are converted to `matchScore`. Frontends must tolerate incomplete scoped player data, so a head-to-head pair is nullable until exactly two players exist. Reverse team ordering applies to every supported team count, including FFA.

Missing or invalid player team IDs normalize to the explicit `null` team key. Broadcaster-first grouping compares against that normalized key, so a known teamless broadcaster's available group can still be selected. When explicit mode is head-to-head and exactly two players are visible, presentation creates one side per player even if both team IDs are absent; observer/replay uses map position and player surfaces use broadcaster-first order. Team modes retain one shared `null` group because missing IDs do not reveal the unavailable team partition.

Public grouping inputs accept both protocol players (`team?: number`) and normalized/persisted view records (`team?: number | null`). Runtime has always treated null and non-finite values as the explicit null group; declarations must not force frontend persistence code to duplicate that behavior.

Explicit FFA modes likewise create one presentation side per visible player before team grouping, even when every team ID is missing. Input order is preserved by default and reversed as a whole when requested. Collapsing teamless FFA players into one `null` side violates the mode's known one-player-per-side semantics; true team modes continue sharing the `null` group.

Overlay extension types must enumerate their keys. Broad string index signatures are rejected because they inherently include normalization-owned names. JavaScript demo/testing helpers also reject explicit `runtime`, `misc`, or `settings` extension branches at runtime instead of silently overwriting them.

When BattleTag discriminator stripping is requested, both the in-game name and account name are normalized before choosing the primary display name. These are behavioral guarantees, not application workarounds.

## 2026-09-10: Explicit ladder records replace mode slots

The user authorized breaking the unreleased SDK 3 contract. `PlayerStatsCollection`
has status (loading, ready, unavailable) and records, with provider/gameMode/queue and optional season/race. Arranged records
require a provider team identity and members. MMR, rank and league are independent
optional observations. Unknown values are omitted. Do not keep old solo/team slots
or preferredStats fallbacks. statsForMode selects an exact, unique record; explicit
queue/teamId options resolve AT/RT ambiguity. Mode metadata now names ladderMode
and distinguishes 3v3 from 2v2. Battle.net socket discovery and querying belong to
the native reader and trusted desktop, never to SDK consumers. The SDK carries
normalized stats only, with no game GUID, process handle, or socket credentials.

Loading is an explicit provider lifecycle, not inferred from absent records.
Consumers may render a loading indicator only during loading. Terminal unavailable
data may later become ready after a verified retry. Local recorder control-group
updates follow realBroadcasterPlayerId in self-play; observer/replay delivery
still requires its capability.

## 2026-09-10: Coordinated release review

SDK 3 CI tests a pinned Match Vision SDK 3 consumer. The main-branch SDK 2 app
is not source-compatible with the breaking instance, stats and timer contracts.
Consumer registry dependencies only advance after SDK 3 is published. The SDK
package includes MIGRATION_3.md; website previews type-check against an unpacked
npm artifact and keep the stable published reference separate.

## 2026-09-10: Required illusion metadata with opt-in selectors

`Unit.isIllusion` is a required boolean inherited by heroes and buildings. The
current reader always supplies it; missing/invalid observations are rejected,
never guessed false. Keep every instance in its existing type collection with
its own identity. Do not introduce an illusion union or separate collection.

`playerUnits`, `playerHeroes`, and `playerBuildings` exclude illusions by default;
`{ includeIllusions: true }` returns every instance. Both modes preserve immutable
object identities. The deterministic-order decision below supersedes observed order. Applications can read the raw maps directly.
These are cross-application selector defaults; an app may enforce stronger
presentation policy, as Match Vision does with an explicit additional filter.
The wire extension does not change the protocol major. Required properties affect
application-created typed fixtures; do not promise universal source compatibility.


## 2026-09-10: Deterministic unit selector ordering

Unit, hero and building selectors sort by ascending full instance ID in both
default and includeIllusions modes. Compare fixed-width lowercase hex strings,
not JavaScript numbers or locale collation. Never mutate input maps or entities;
keep memoized immutable output arrays. This stabilizes presentation across
transport/snapshot insertion order and removal/reinsertion, but does not promise
spawn order: Warcraft uses separate serial counters for its two agent tables.


## 2026-09-11: Optional native hero order

`Hero.heroOrder` is the positive player-relative key used by Warcraft's hero-bar
comparator. It is not original spawn time or a permanently assigned F-key slot.
Keep it optional until a valid native observation arrives. Preserve the last
valid value across missing/invalid order observations and health-only updates;
clear it with the owning hero on removal, ownership transfer or match reset.
Native and API projections must agree. General selectors retain their documented
full-ID order; presentations may sort by this key with a full-ID tie-breaker.
This additive field does not change the protocol major or require old consumers
to upgrade. The SDK 3.1.0 release remains paused for review.

## 2026-09-12: Forward the native applied HUD scale without reconstruction

The user explicitly authorizes the coordinated removal of the native raw 0–128
HUD transport. `W3HudScale.value` is now the applied finite float in 0.5–1.0;
`initialRuntime.hudScale` supplies the platform's initial snapshot. SDK local
recorder projection validates and forwards the number unchanged. Remove the
piecewise percentage calculation, rounding and clamping. Invalid observations
preserve current state; public gameContext and its default 1 are unchanged.

This changes the recorder transport meaning and requires upgrading SDK consumers
with the native library/platform. Older SDKs must not consume new recorder frames:
raw integer 1 and normalized float 1 cannot be distinguished heuristically. A
production audit found only six first-party-owned app registrations; it cannot
rule out unregistered public SDK experiments. No release is authorized here.

## 2026-09-12: Generated game data, actual rawcodes, SDK/protocol 4

The user explicitly favors a clean breaking API over compatibility with unused
external consumers. `/game-data` loads an immutable exact `match.gameDataId` from
hosted generated output. Unit, ability, item and upgrade collections share type IDs
with observed data; artwork is derived from object fields and content-hashed. Keep
level-specific names/costs/images ordered. Preserve actual variant ability rawcodes
and actual ultimate levels; remove manual alias, icon, cooldown and upgrade tables.

Static data stays outside the eager SDK graph and npm payload. The loader verifies
checksums, caches successful revisions and never substitutes another patch. The
broad retained unit projection is separately lazy. Unknown object art returns
undefined; no filename guesses or Cancel placeholders. Live stats remain authoritative.
Game conventions unrelated to object configuration remain in `/standard-game`.
Version 4.0.0 / protocol 4.0 coordinates the breaking field and metadata changes;
publication is separate from local packed-package validation.

## 2026-09-13: Share timed progress across building upgrades and item cooldowns

`Building.upgrade` carries the observed destination type and `TimedProgress`,
separate from `production.queue`. `Hero.inventoryCooldowns` aligns with inventory
slots and contains direct engine `TimedProgress` observations or null. Duplicate
item rawcodes must never merge timers. Inventory replacement without timers clears
old associations. Both transports validate the same bounds and slot occupancy.
The ability cooldown helper uses the same progress/remaining/total fields but
continues deriving them from activation and catalog data; its `active` flag is
helper output, not a new live protocol requirement.

## 2026-09-14: Engine APM and live mana regeneration are optional observations

`Player.apm` carries Warcraft's own nonnegative integer average under resources
access, restricted to the real local player in self-play. Observer/replay data
may include every participating player. `W3PlayerMetrics.apm: null` clears the
observation; zero is valid. `player.apm.changed` follows normal domain events.
Do not synthesize APM from browser input, action counting or elapsed wall time.

`ValuePool.regenerationPerSecond` is optional, currently emitted for hero mana.
It carries the finite current net rate, including zero/negative values; absent
rates remain unavailable. Recorder updates preserve it and clear stale rates.
Apps own mana-deficit labels and estimates, using observed rate and learned-level
catalog mana cost. This additive contract works with older snapshots.

## 2026-09-14: Hero combat totals are engine observations

Publish optional `Hero.combat` under the existing hero scope, identity and
self-play ownership boundary. Native code reads build/code-validated cumulative
unit fields at the shared 200 ms cadence; hero-only vitals calls retain that
observation. Unreadable values clear the observation. Never accumulate browser
HP deltas or carry totals across unit identities or matches. Lower observations
replace prior values on replay rewind. Death/revival can retain the same identity
and engine counters.

`damageDealt`, `selfDamage`, `damageReceived` and `healingDealt` count actual HP,
with damage after mitigation and overkill caps, and healing after overheal caps.
Subtract `selfDamage` from either damage total to obtain damage to/from other
units. These categories still include friendly fire and neutral targets; they
are not enemy-only damage. Summon attribution beyond the engine's own source
resolution is not inferred.

Live Paladin tests prove that `healingDealt` includes healing other units,
self-targeted Healing Wave and self-used healing potions. Ordinary regeneration
and direct SetWidgetLife changes do not increment it. No independently validated
self-healing counter exists, so an exact healing-to-others total is unavailable.
Do not relabel total healing as healing others or guess attribution from target
HP changes. See `packages/w3blib/tools/hero-combat-probe` in the platform repository
for code provenance and owned live evidence. No deployment is authorized by this
implementation work.

## 2026-09-15: Optional player-stats cache provenance

PlayerStatsCollection may include source (live/cache) and observedAt (Unix
milliseconds of the original observation). Cached Battle.net values are a
bounded fallback after a new match lookup exhausts its retries. Preserve their actual age rather
than stamping them as newly observed. Keep both fields optional for existing
providers and older servers; validate supplied values and preserve them through
normalization, freezing and stats change events. Exact ladder selection is
unchanged. New consumers can choose how to present cache age; no SDK UI policy
or protocol-major change is introduced.

## 2026-09-15: Local economy respects self-play ownership

The recorder now supplies the real local player's economy during self-play using
existing W3Resource fields. Apply local resource updates only to the real
broadcaster in self-play, as already done for APM and control groups. Observer and
replay modes retain their participant resources. Keep the same resource capability,
match-ID checks and gold/lumber normalization. No public type/version change is
needed. API projection enforces the same boundary before state delivery.

## 2026-09-16: Summon-inclusive damage and unit contributions

At the user's request, publish unit contributions instead of an incomplete
ability breakdown. `Hero.combat.damage` adds `total`, `breakdown`, and `complete`
without changing the SDK 4.2 engine-counter meaning of `damageDealt`.
Each contribution has `damageDealt` and `units` (`typeId`, `isIllusion`). Group
repeated sources of the same type, retaining the real/illusion distinction.
Where Warcraft redirects summon damage, list all contributing types in one
shared entry. Never label that amount as the hero's direct damage or show the
redirected attacker as zero. Count each contribution once when reconciling total.

The recorder owns source identity, attribution, lifetime retention and rewind
reset. Standard-melee unique-caster fallbacks do not promise arbitrary custom-map
or ambiguous duplicate-caster attribution. Late recording and lost source reads
make `complete` false. The SDK validates finite, nonnegative, bounded, reconciled
contributions; copies/freezes nested arrays through existing state paths; and
preserves hero-scope and self-play ownership gating. The optional field supports
older producers. Browser consumers must not add current summon counters again.


## 2026-09-16: Neutral POIs freeze at game start during self-play

Expose match-scoped `pois` under `match:read` and `pois:read`, with an explicit
`poiMode`. At the user's direction, self-play captures the initial buildings,
positions and starting inventories once, without visibility filtering. After
that snapshot the native POI reader stops reading POIs for the entire match;
observations, purchases, removals and cooldown changes never refresh it.
Reducers also reject every subsequent self-play POI replacement or invalidation.
The snapshot resets with the match, not with application reconnection. Never
advance its timers against the current game clock. A late attachment cannot
substitute current inventory for an unavailable game-start snapshot.

Observer/replay mode may publish live full replacements and explicit invalidation;
replay rewind replaces values rather than merging old assortments. POIs use full
instance identities and the shared TimedProgress contract. Missing optional fields
mean unavailable, not zero or empty. Static catalog stock defaults are separate
from observed map-specific inventory. Native layouts require build and code
witness validation; synthetic tests do not establish live gameplay correctness.
Implementation coverage and live acceptance evidence are recorded in
`docs/neutral-pois.md` in the platform repository. No release is authorized.

## 2026-09-16: Partial local economy does not fabricate zero values

The local recorder transport retains actual resource observations by player/type
across messages and same-match reconnects, and clears them on match changes.
The reducer accumulates that retained batch before publishing `Player.resources`:
gold, lumber, supply and supplyCap are required, while workerSupply is optional.
Worker-only packets and incomplete economy stay unavailable, matching the API's
existing completeness rule. Never initialize unobserved fields to zero. Actual
measured zero remains valid. Native `W3Resource.value: null` explicitly removes an
observation; malformed, negative or nonnumeric values are ignored. Invalidation
of a required field removes the public resource object until recovery. Existing
match, scope and real-local-player ownership checks apply before accumulation.
The public Resources type is unchanged. Publish this alongside the native repair
so local clients understand its unavailable observations.

## 2026-09-17: Item charges are slot-aligned live observations

`Hero.inventoryCharges` contains remaining nonnegative signed-32-bit counts,
aligned with `inventory`. Null slots and missing arrays mean unavailable; an
observed zero remains zero. Validate lengths, empty-slot associations and values
at both recorder and snapshot boundaries. Inventory replacement without counts
clears old counts, even when the rawcodes are unchanged. Duplicate item types
remain independent slots and use the recorder's full item-instance identity.
Existing hero scope and self-play ownership rules apply.

`ItemType.initialCharges` is optional build-pinned catalog configuration from
ItemData `uses`, distinct from remaining charges and shop stock. Consumers decide
which badges to show; the SDK does not infer uses from cooldowns or substitute
starting charges for missing observations. Older catalogs/recorders remain valid.

## 2026-09-17: Native hero-bar extent preserves empty slots

Expose optional `gameContext.heroBarLastOccupiedSlot`: the one-based last visible
native portrait, zero for an observed empty bar, absent when unavailable. Do not
infer it from owned/controllable hero counts, shared-control flags or heroOrder.
One owned hero plus one shared hero occupies slots 1 and 4. Dead portraits can
still occupy space, and the current game caps the rail at seven slots.

The build-validated native reader follows typed CGameUI/CHeroBar/button objects,
checks every slot and repeats identity/visibility reads without the cycle cache.
The patch workflow rediscovers this profile alongside the existing HUD root.
Initial hydration, incremental changes, explicit invalidation and match resets
carry the observation through datamodel/API/SDK without granting allied stats.

Match Vision owns layout policy: reserve max(3, lastOccupiedSlot) rows on the
left during self-play and derive the scrolling limit from the same boundary.
Retain the three-row fallback when unobserved; observer/replay and right-side
placement stay unchanged. Hero rail geometry uses the existing application scale,
not the independently adjustable lower Warcraft HUD scale. This is local release
preparation and does not authorize publication or deployment.

## 2026-09-18: Bounded interpolation of engine-anchored values

The user explicitly requested SDK calculation to reduce continuously regenerated
recorder data. This revisits the September 9 no-wall-clock-countdown decisions for
health/mana and known active production/construction/upgrade timers. The public
numeric types stay unchanged. No estimate is added to an unknown timer or initial
POI stock snapshot.

Consume private validated engine anchors and two precise simulation clock domains.
The recorder sends clock/rate samples every 200 ms. Derive immutable public values
at 50 ms intervals against the selected domain; wall time only advances the
observed simulation rate, never replaces game time. Bound extrapolation to one
second from receipt, including metadata age. Reset timers for stream gaps,
disconnects, source/match changes and teardown. New samples correct speed changes,
pauses, backward seeks, damage and Human power-building rates. Terminal states use
the last engine time without ticking.

Keep platform snapshots/patches authoritative and separate from derived values.
Hide all timing/clock transport metadata from public state. Local recorder anchors
must pass the same existing permissions and ownership projection first. Full
reconnect snapshots restore all permitted current anchors. Do not create or remove
jobs, units or lifecycle transitions when interpolated progress reaches a bound.
Existing changed events follow derived numeric snapshots.

Release together with the new API, recorder and bundled consumer apps; an older
SDK cannot advance the new sparse samples. Publishing/deployment is separate from
implementation. See INTERPOLATION.md for consumer behavior and validation scope.

## 2026-09-18: Retire Netease stats provider

The platform owner explicitly retired Netease. Limit the public stats-provider
union and runtime validation to `bnet` and `w3champions`, matching the platform's
removal of the native and server integration. Unknown providers remain invalid.
Refresh generated contracts and consumer fixtures locally; do not publish or
change registry pins as part of this cleanup.

## 2026-09-18: Optional native in-game menu observation

gameContext.menuOpen reports the native input owner's menu/dialog classification,
independent of pause, match status, observer status and replay mode. Accept only
booleans; a null W3MenuState update withdraws the observation, and match reset
clears it. Preserve initial platform snapshots and local recorder updates without
changing lifecycle or scope. Consumers choose surface-specific hiding; the SDK
continues collecting while a menu is open. This additive field supports older
producers and does not authorize publishing.

## 2026-09-18: Keep the menu release on SDK 4.5

The owner confirms Netease was never used by any integration and is leftover
legacy code, so its cleanup does not warrant a major version bump. Supersede the unpublished SDK 5 proposal with SDK 4.5.0.
The provider union still narrows; do not restore obsolete support or describe
that removal as additive. The menu observation is additive and protocol remains
4.0. Registry pins change only after publication; packed candidates validate
integration locally. Nothing was published under the proposed SDK 5 version.


## 2026-09-20: Default hotkeys are optional settings metadata

Public boolean fields may declare `defaultHotkey` using the Windows desktop's
canonical accelerator subset. The directly authored settings entry validates and
preserves this metadata, rejects duplicate defaults within a schema, and keeps it
out of generated user setting values. Desktop/API validation matches the SDK.
User overrides, OS registration, permissions, global conflict resolution and UI
remain platform responsibilities. No browser keyboard listener or dynamic
hotkey-registration API belongs in the SDK. This is an additive, unreleased
contract; it does not change settings delivery or native Warcraft state.

## 2026-09-20: Observer outcomes and optional match analytics history

The caster requirements add `Match.outcomes` without changing the meaning of
local-player `Match.result`. Outcomes are explicit per-participant observations;
unknown/partial results and replay exits never imply a winner. Optional per-player
observer statistics and sampled death counters use the existing independent data
grants. Both hosted and local-recorder projections enforce the same policy.

The optional generated `analytics` entry supplies bounded game-time history and
loss-window aggregation without frameworks, timers, transport or persistence.
Counter deltas carry observation intervals; late joins/gaps do not fabricate past
events. Coverage, sampled completeness and window-boundary uncertainty are separate.
Static costs require the match-pinned catalog; unknown values stay null and sales
require an explicit refund policy. UI and scoreboard deduplication stay app-owned.
See ANALYTICS.md. These additions are prepared locally, not published.


Player analytics extend to the actual local player in self-play, under existing
grants; observer/replay access retains participant scope. Preserve native and
catalog semantics: retained unit instances are not lifetime production, wall-clock
hero age is not match time, and static definitions do not assert custom-map
runtime values. The optional analytics entry owns bounded history and window
estimation; applications own presentation and persistence.


## 2026-09-21: Optional data additions must preserve SDK compatibility

The user explicitly accepts the current ownerSlot transition and requires future
optional attributes to remain compatible with installed SDKs. Validate known
fields, required structure, bounds, identities and permissions; do not reject a
valid gameplay object merely because it contains additional JSON fields. This
applies to nested objects as well as top-level state and includes the datamodel
validator shared by hosted and local-recorder delivery.

Preserve unknown public fields through snapshots and patches without interpreting
them, so subsequent patch paths remain valid. POI field allowlists must not act
as closed schemas. Existing JSON safety checks, private transport projection and
self-play restrictions still apply. This rule concerns added optional fields;
changing required fields, existing meanings/types or closed enum values requires
an explicit compatibility decision. Regression tests must exercise unknown
nested fields, subsequent patches and malformed known fields together.

## 2026-09-23: Economy history resets on withdrawn or stale observations

A real replay exposed a native economy dropout while the opponent continued.
Keeping the missing player's last sample let consumers compute a false +720
advantage from points 78.7 game seconds apart. `economy()` now returns the current
contiguous segment: absent/invalid gold or upkeep, or statistics more than five
game seconds from the match clock, clear it; recovery starts a new segment.
Observed zero remains valid. Consumers must compare matching sample times.
The API shape remains unchanged; no timers, interpolation or fabricated income.
