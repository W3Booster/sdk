# Changelog

## 1.1.0 - 2026-09-05

- Added unconditional `state.gameContext` and the `gameContext()` selector for HUD scale, chat visibility, and team-color mode, including legacy snapshot normalization and recorder updates without `overlay:read`.
- Added app-owned `application.data`; Match Vision receives its score there. Deprecated the generic overlay runtime and score helpers while retaining the deprecated SDK methods for source compatibility.
- Retained `overlay:read` as a deprecated, unnecessary scope for existing app bindings. Data grants such as `resources:read` still control access to their respective data.

## 1.0.3 - 2026-09-04

- Added a runnable public starter and first-app/tutorial/reference links on the prerelease documentation host.
- Bound settings-definition fetches to ten seconds and added actionable connection errors and initialization next steps.
- Aligned the settings CLI's default definition endpoint with the runtime's `api.w3booster.com` API origin.
- Resolve the packed SDK dependency before installing the Match Vision CI consumer to avoid npm's dependency-tree replacement failure.

## 1.0.2 - 2026-08-21

- Made each managed-runtime startup timeout cover transport opening, retry backoff, and readiness without cancelling shared startup, and report `STARTUP_TIMEOUT` instead of the readiness-only `STATE_TIMEOUT` code.
- Accepted nullable-team lightweight records in mode-aware `orderMatchTeams()` declarations, matching runtime behavior and the team-grouping API.
- Rejected lifecycle subscriptions created after a managed runtime has stopped.
- Added an opt-in lifecycle observation for a finished match present in the initial hydrated snapshot.
- Exposed initial retry attempt, limit, delay, and last failure through the atomic lifecycle snapshot.
- Rejected insecure remote and credential-bearing compositor child URLs.
- Preserved one reversible presentation side per player for explicit FFA modes with missing team IDs.
- Kept explicit team-mode observer ordering broadcaster-first even with an unexpected visible group count.
- Added inferred implementation-to-declaration assignability checks for every directly authored public entry point.
- Corrected standard-game object metadata declarations to include shipped numeric fields.
- Rejected array root models at typed client, generated-application, and testing call sites while retaining nested JSON arrays.
- Accepted normalized `team: null` records in public team-grouping declarations.
- Closed selector-store subscription teardown when an abort occurs during a synchronous source startup update.
- Added a launch-aware standard-game asset resolver that binds Warcraft icons and country flags to one validated asset origin.
- Replaced parallel JavaScript/declaration surfaces for the root API and core frontend subpaths with generated TypeScript facades and generated version declarations.
- Made optional settings lifecycle hooks package-manager neutral by invoking the installed SDK CLI directly.
- Preserved modern overlay runtime values when legacy private metadata coexists during protocol migration, with modern values taking precedence.
- Added a typed `headToHeadPair()` selector and tuple-preserving head-to-head ordering overload for incomplete scoped frontend state.
- Made reverse observer ordering apply consistently to multi-team and free-for-all matches.
- Added compile-time assignability checks between private runtime modules and their generated public value contracts.
- Serialized all host setting writes so overlapping parent and child paths preserve request order.
- Added parser-validated generic host acknowledgements while retaining the deprecated SDK 1 typed overload for source compatibility.
- Made the release gate fail when committed generated API files are stale.
- Enabled checked-JavaScript validation over the public runtime graph in addition to public-contract assignability checks.
- Made BattleTag-discriminator stripping apply consistently to account and in-game display names.
- Made presentation-team ordering mode-aware across player, observer/replay, team, FFA, and incomplete scoped snapshots.
- Added plain-ESM generated application bindings for `.js`, `.mjs`, and `.jsx` settings outputs.
- Rejected unrestricted overlay-extension index signatures and SDK-owned demo extension branches.
- Replaced subclass-based cooldown maps with frozen read-only facades whose private backing maps cannot be mutated through `Map.prototype`.
- Preserved broadcaster-first and explicit head-to-head ordering when scoped player records omit optional team IDs.

## 1.0.1 - 2026-08-19

- Changed the standard cloud API origin from the retired direct `app.w3booster.com:14969` endpoint to the proxied `https://api.w3booster.com` endpoint for stream tickets and compositor requests.

## 1.0.0 - 2026-08-19

- Notified state subscribers and watchers on synchronization-freshness-only transitions, and preserved overlay-extension generics in generated application aliases.
- Kept broadcaster-independent Match Vision surfaces visible when authoritative broadcaster identity is unavailable.
- Added the promised locale-neutral `raceInfo()` accessor and automated checks that synchronize every public runtime/declaration export and validate README namespace calls.
- Made Match Vision require explicit broadcaster identity before applying broadcaster display settings, and carried generated-runtime resolved settings atomically into every surface.
- **Breaking:** replaced SDK-owned English `raceName()` / `raceShortName()` copy and race label fields with locale-neutral `raceInfo(...).localizationKey` and `shortLocalizationKey`; applications now own translations.
- Versioned the new frontend/store contract as a new major so clean consumers cannot resolve it to the earlier `0.2.0` artifact.
- Exposed the completed same-match snapshot directly as `event.match` for ended lifecycle events, including authoritative `endedAt` when supplied.
- Returned branded native immutable cooldown maps, distinguished shared-runtime caller cancellation from standalone startup options, and preserved null upkeep input as unavailable.
- Reused safe SDK pool ratios for Match Vision mana bars and added actionable application-definition mismatch guidance.
- Made match lifecycle observations derive from one state stream so subscriptions created during a transition receive it exactly once.
- Added validated authoritative `match.endedAt` completion timestamps while retaining explicit client-observed lifecycle timing as a fallback.
- Made race metadata locale-neutral through stable localization keys; display-language copy remains application-owned.
- Accepted both eager and change-only source stores without suppressing the latter's first real frontend update.
- Separated Match Vision's player presentation overrides from authoritative SDK player fields through an explicit view model.
- Negotiated generated application-definition revisions with the broker and exposed a permanent `APPLICATION_DEFINITION_MISMATCH` error for stale bundles.
- Preserved additive public overlay extension branches while continuing to remove private recorder and legacy settings fields.
- Preserved public `overlay.runtime` values from typed custom/testing transports and kept additive overlay branches through demo transport adaptation.
- Propagated an explicit overlay-extension generic through state, clients, lifecycle, events, testing transports, and generated application runtimes.
- Added framework-neutral selector stores and made the React selector adapter build on the same implementation.
- Observed synchronous and asynchronous selector-store subscriber failures through a configurable `onError` hook.
- Routed eager selector-store subscriber failures through the same `onError` contract as later notifications and observed asynchronous error reporters.
- Added immutable-input selector memoization, stable allocation-heavy SDK selectors, and generic lightweight-record team grouping.
- Defined memoization as caller-owned identity invalidation, preserved lightweight record subtypes through broadcaster/team ordering, and added structured player display identity.
- Replaced one-entry selector caches with weak multi-identity caches suitable for interleaved lists and views.
- Limited public selector caching to recursively frozen inputs so mutable frontend collections always recompute.
- Preserved SDK issue reporting through derived selector-store chains without requiring application wiring.
- Made cooldown timestamps explicitly positive, retained fractional-second precision, and added tuple-preserving head-to-head ordering types.
- Kept concurrent generated-runtime startup milestones, timeouts, and cancellation independent over one shared transport open.
- Cached allocating React selector snapshots by source identity to satisfy `useSyncExternalStore`, completed typed demo overlay fixtures, and bounded Match Vision's profile-selector variants with the SDK memoizer.
- Stabilized whole-state cooldown derivation, added explicit lifecycle `observedAt` timing, and composed BattleTag discriminator handling into player display identity.
- Consolidated standalone-client and generated-runtime readiness validation/waiting while retaining their distinct cancellation ownership.
- Distinguished initial retrying from reconnection, accepted startup cancellation for unlimited incomplete retries, and added an initial-aware match lifecycle subscription.
- Generated bound client/runtime/snapshot aliases and exported the canonical unavailable-host lifecycle snapshot.
- Made overlay extensions deeply read-only and rejected normalization-owned `runtime`, `misc`, and `settings` extension keys.
- Rejected non-JSON settings and extension models at client creation in TypeScript.
- Made whole-state cooldown collections and values immutable and added canonical Warcraft III upkeep classification adopted by Match Vision.
- Made standard-game rawcode/entity icon resolution strict, with an explicit filename URL escape hatch.
- Added a dependency-free observer-style `Subscribable` adapter for Angular, RxJS, and other frontend integrations.
- Aligned every Match Vision observer surface on the SDK's canonical team ordering and made service restart races generation-safe.
- Made `playerResources()` and `matchScore()` preserve unavailable data as `undefined`; use the new explicit `playerResourcesOrZero()` and `matchScoreOrZero()` presentation fallbacks when zeroes are intended.
- Added explicit `open()` / `openClient()` transport-ready names and `startClient()` synchronized startup while retaining deprecated `connect()` aliases.
- Aligned wildcard `once('*')` TypeScript declarations with the supported runtime behavior.
- Kept the SDK framework-neutral and documented that framework lifecycle, dependency injection, and UI state belong in consuming applications.
- Routed generated application-runtime listener failures through the structured client issue channel.
- Deferred demo and local-recorder modules until they are actually needed.
- Split standard-game icon and cooldown metadata into independently importable entry points while preserving the combined objects API.
- Documented that trust-sensitive identity redaction is enforced by the platform server, not by consumer-controlled SDK code.
- Added compatibility linting against the declared browser targets.
- Made reconnect-time `connect()` and connected-only startup wait for a genuinely active transport.
- Stopped compositor watchers after permanent authorization, configuration, and protocol failures.
- Added cancellable, timeout-aware host actions with precise result and JSON-payload types.
- Made frontend error classification a TypeScript-discriminated union.
- Expanded browser smoke coverage from Chromium alone to Chromium, Firefox, and WebKit.

## 0.2.0 - 2026-08-18

- Added a managed generated-application runtime that atomically exposes connection state, resolved settings, and reactive host capabilities with single-flight startup and teardown.
- Replaced the public recorder-shaped `overlay.misc` object with `overlay.runtime` and a nested `matchScore`, while retaining the legacy shape only at the private protocol boundary.
- Added reusable player-resource, player-hero, and match-score selectors.
- Rejected `Date`, `Map`, custom prototypes, and other non-JSON objects in settings instead of silently erasing their values during cloning.
- Declared and smoke-test enforced the browser runtime floor: Chromium/Edge 92, Firefox 90, and Safari 15.4.
- Preserved application-visible overlay identities when hidden control-plane metadata is removed, including across unrelated patches and recorder overlays.
- Added explicit host capability discovery states and `host.can()` so frontends no longer have to interpret an empty capability list.
- Kept missing broadcaster identity distinct even when a player uses an unusual string ID.
- Added reusable overlay-runtime, render-identity, observer-ordering, team-color, and hero-progress helpers adopted by Match Vision.
- Moved generated application connection, startup, and settings-resolution behavior into `@w3booster/sdk/app`; generated files now contain only schema-derived types, metadata, and one typed binding.
- Kept application lifetime and one-shot startup cancellation signals independent in bound application startup.
- Removed legacy overlay settings and recorder endpoint metadata from application-visible state while retaining them on the internal authenticated platform baseline.
- Made event payloads immutable across listeners and documented concurrent async listener delivery.
- Replaced the ambiguously named frontend adapter with `@w3booster/sdk/react`, including explicit server snapshots for `useSyncExternalStore` and framework recipes for Angular signals and RxJS.
- Aligned compositor endpoint selection with the main client (`backend` plus `backendUrl`) and stopped exposing transport-level state messages as application events.
- Simplified host actions to one acknowledged async method per operation instead of parallel fire-and-forget and `AndWait` variants.
- Made runtime clients true read-only facades: direct construction is rejected and internal state, lifecycle, event-emitter, host, and transport mutation is hidden behind private fields.
- Made startup signals cancel transport opening as well as readiness, preserved SPA history state while consuming launch credentials, and added stable discriminated frontend error classification.
- Bound host actions to a captured application launch and embedding origin, refreshed host capabilities automatically, and stopped treating ordinary broker authentication as blanket parent-window authorization.
- Added framework-neutral multi-subscriber external-store adapters, match-aware asset resolvers, safe value-pool helpers, and standard head-to-head map-position ordering adopted by Match Vision. Implicit asset mirrors are restricted to platform-selected loopback development launches.
- Consolidated exponential reconnect policy across broker, compositor, and recorder transports, preserved compositor permission/protocol/configuration error kinds, and stopped hiding anonymous platform failures as empty compositions.
- Separated structured non-fatal recorder/listener issues from lifecycle connection errors, and added issue source, severity, and recoverability metadata.
- Added configurable established-socket reconnect policies and stopped reconnecting after permanent authorization, configuration, and protocol failures.
- Added `client.start()` and bound `w3boosterApp.start()` for long-lived frontends that need synchronized state without a fragile default startup timeout.
- Made startup reject terminal synchronization failures, clean up bound-application clients on failure, and normalized escaped map names once at SDK ingress.
- Added acknowledged window actions and host capability discovery.
- Added observer/replay match selection, made cooldown maps use hydrated ability identity, enforced hero/ability identity invariants, and restored overlay-runtime spelling safety.
- Added fresh-state synchronization with `state.isSynchronized`, `whenSynchronized()`, immediate `subscribeStatus()`, and an atomic `client.lifecycle` snapshot for framework integration.
- Added typed hero, ability, upgrade, and inventory artwork helpers, a deduplicating current-upgrades selector, public capability helpers, and deterministic complete demo-state fixtures.
- Added a strict `backendUrl` escape hatch while keeping standard backend selection typo-safe.
- Made settings synchronization explicit and offline-friendly by default, persisted custom endpoints, made lifecycle hooks opt-in, and memoized generated resolved-settings values.
- Classified permanent broker HTTP failures as non-retryable `CONFIGURATION` errors with the response status.
- Made `watch()` use `Object.is()` by default and accept an explicit comparator, avoiding unconditional deep clones and comparisons in rendering paths.
- Generated recursively partial delivered-settings types and typed immutable defaults resolvers for database-bound applications.
- Made host commands and match-score actions acknowledged by default and captured the authenticated application-launch context used by the host bridge.
- Added canonical game-time formatting, preferred-statistics selection, and whole-state ability-cooldown helpers adopted by Match Vision.
- Kept internal store, event-emitter, and host implementations out of the runtime root exports and consolidated shared network primitives used by application and compositor transports.
- Split broker/credential, host, reactive lifecycle, recorder, protocol, error, network, and immutable-value concerns into focused internal modules without exposing implementation classes.

- Added `@w3booster/sdk/assets` with safe, versioned country-flag URL helpers for country identifiers exposed by the SDK.
- Added host-aware asset-base resolution and moved the optional Warcraft III object table to `@w3booster/sdk/standard-game/objects` to keep ordinary frontend bundles small.
- Added synchronous `createClient()` so frontends can subscribe before the initial connection lifecycle begins.
- Added acknowledged, type-safe settings persistence plus named match-score and window host actions.
- Added database-owned settings schema validation, default derivation, generated typed frontend bindings with app-bound lifecycle helpers, and the `w3booster-settings` init/sync/check CLI. Its one-time `init` stores project binding metadata and adds explicit synchronization commands; `--install-hooks` opts into dependency/dev/start/build hooks without replacing existing commands.
- Added stable connection error codes and public `isAbortError()` / `isW3BoosterError()` guards.
- Added semantic standard melee-mode metadata and removed typo-prone arbitrary-string event overloads in favor of explicit unknown-event methods.
- Added SDK-owned transient initial retries with configurable capped backoff, lifetime `AbortSignal` teardown, signal-bound subscriptions, and abortable readiness waits.
- Required an `AbortSignal` for unlimited retry policies so convenience connections always have a cancellation path.
- Added strongly typed nested application-setting paths and values to `host.setSetting()`.
- Forwarded rejected async state and event listeners to the SDK error channel instead of leaving unhandled promise rejections.
- Made pending readiness waits reject immediately on disconnect and made automatic backend fallback distinguish request timeouts from user cancellation.
- Restricted host actions and automatic resizing to verified W3Booster application launches and used the embedding origin when it is available.
- Documented public timing, resource, HUD-scale, and map-coordinate conventions and removed reliance on `URLSearchParams.size` for embedded-browser compatibility.
- Expanded demo mode into a complete deterministic frontend fixture with typed settings, all standard capabilities, and an optional static interval.
- Added compositor cancellation/lifetime signals, clear missing-credential failures, and async listener error isolation.
- Validated compositor options and successful app payloads so the typed compositor API cannot return malformed entries.
- Added explicit host auto-resize control, strict connection-option validation, accurate public error constructors, and JSON-safe setting validation.
- Clamped and validated HUD scale to its documented `0.5`–`1.0` contract and made missing browser transport APIs fail without futile retries.
- Added Node 18 packed-package checks and real-Chrome CI coverage for the browser lifecycle.
- Preserved object identity for untouched state branches and coalesced local recorder bursts to one publication per display frame.
- Suppressed recorder publications when the effective state did not change.
- Held patches after reconnects, incremental sequence gaps, and invalid protocol data until a fresh snapshot, while accepting complete forward snapshots directly as a new baseline.
- Preserved platform-owned hero names and additive metadata when overlaying low-latency recorder values.
- Made hydrated state recursively read-only in TypeScript and made absent application settings explicit in change events.
- Made custom demo states safe without two resource-bearing players.
- Added a packed-package TypeScript consumer test for every public export path.
- Renamed the observer/replay low-latency option to `localRecorder` and its active diagnostic value to `recorder-local`.
- Made explicit disconnect clear state and diagnostics while preserving subscriptions for a clean reconnect.
- Moved W3Booster compositor infrastructure to `@w3booster/sdk/compositor`.
- Moved custom transport types and the demo transport factory to `@w3booster/sdk/testing`; normal app demo mode remains `connect({ demo: true })`.
- Expanded lifecycle, capability, error, troubleshooting, settings, and browser-support documentation.
- Made concurrent connections single-flight, added initial connection cancellation, and bounded WebSocket handshakes.
- Refreshed explicit token providers for every broker ticket and bounded never-opening local recorder sockets so advertised fallback URLs can be tried.
- Enforced JSON Patch `replace` target existence and cancelled deferred host resize setup during teardown.
- Rejected invalid recorder updates before caching them so later authenticated snapshots cannot reintroduce malformed local data.
- Made disconnect abort in-flight reconnect authorization and extended broker timeouts through response-body parsing.
- Made automatic backend fallback continue after local authorization failures and establish backend-specific compositor sessions.
- Aligned compositor and testing declarations with emitted development metadata and synchronous custom transports.
- Stopped disconnected recorder caches from masking newer platform snapshots and decoupled recorder game time from overlay presentation settings.
- Made compositor watches renew expired sessions and reauthorize every reconnect.
- Aligned runtime validation with the declared match, player, hero, resources, statistics, and application state types.
- Canonicalized main-account races to the public race strings and documented/validated win rates as percentages from 0 through 100.
- Removed the unused injected bridge transport and unproduced `platform.reload` compatibility event.

## 0.1.2 - 2026-08-02

- Made platform-issued `backend=local|cloud` launch parameters select the SDK backend without application-specific code.
- Made W3Booster Cloud the default backend. Local platform connections now require an explicit `backend: 'local'` or `backend: 'auto'` option.
- Added the low-latency observer/replay transport: authenticated platform state remains the baseline while recorder updates advertised by that state are consumed directly from the local system.
- Established one canonical state contract before public adoption: `client.state`, `StateStore`, `get()`, `player()`, hero `inventory`, explicit upgrade levels, and mandatory protocol versions.

## 0.1.1 - 2026-08-01

- Switched automated releases from a long-lived npm token to GitHub Actions trusted publishing with OIDC and automatic provenance.
- Kept backend URL validation deterministic in runtimes without a native WebSocket implementation.

## 0.1.0 - 2026-08-01

- Added pure live-state selectors under `@w3booster/sdk/selectors` for active matches, explicit broadcaster lookup, team grouping with IDs, player relationships, hero inventory, and BattleTag display names.
- Added the optional `@w3booster/sdk/standard-game` namespace with immutable shipped Warcraft III object metadata and typed helpers for rawcodes, cooldowns, races, colors, melee modes, hero progression, and weapon/armor upgrades.
- Added safe, versioned Classic/Reforged icon URL helpers and an overridable asset base URL. Warcraft artwork remains outside the npm package.
- Added the complete generic public match-state model and typed application settings.
- Added `client.state`, `whenReady()`, string-form `connect(clientId)`, and `host.setSetting()`.
- Added explicit SDK and protocol versions plus protocol negotiation.
- Added runtime envelope/state validation, message-size limits, safe JSON Patch handling, and application-identity checks.
- Refuse insecure remote API and WebSocket endpoints so credentials are only sent over encrypted connections; plain HTTP/WS remains available on localhost for development.
- Isolated application listeners and rejected non-JSON transport values so consumer errors cannot interrupt state delivery.
- Apps now use the scopes configured in their application record by default.
- Removed the obsolete direct channel/secret data transport; browser-source credentials only authenticate the compositor.
