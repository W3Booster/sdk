# Changelog

## 0.2.0 - 2026-08-18

- Made runtime clients true read-only facades: direct construction is rejected and internal state, lifecycle, event-emitter, host, and transport mutation is hidden behind private fields.
- Made startup signals cancel transport opening as well as readiness, preserved SPA history state while consuming launch credentials, and added stable discriminated frontend error classification.
- Bound host actions to a captured application launch and embedding origin, refreshed host capabilities automatically, and stopped treating ordinary broker authentication as blanket parent-window authorization.
- Added framework-neutral multi-subscriber external-store adapters, match-aware asset resolvers, safe value-pool helpers, and standard head-to-head map-position ordering adopted by Match Vision. Implicit asset mirrors are restricted to platform-selected loopback development launches.
- Consolidated exponential reconnect policy across broker, compositor, and recorder transports, preserved compositor permission/protocol/configuration error kinds, and stopped hiding anonymous platform failures as empty compositions.
- Separated structured non-fatal recorder/listener issues from lifecycle connection errors, and added issue source, severity, and recoverability metadata.
- Added configurable established-socket reconnect policies and stopped reconnecting after permanent authorization, configuration, and protocol failures.
- Added `client.start()` and generated `startW3BoosterApp()` helpers for long-lived frontends that need synchronized state without a fragile default startup timeout.
- Made startup reject terminal synchronization failures, clean up generated-helper clients on failure, and normalized escaped map names once at SDK ingress.
- Added acknowledged window actions and host capability discovery.
- Added observer/replay match selection, made cooldown maps use hydrated ability identity, enforced hero/ability identity invariants, and restored overlay-runtime spelling safety.
- Added fresh-state synchronization with `state.isSynchronized`, `whenSynchronized()`, immediate `subscribeStatus()`, and an atomic `client.lifecycle` snapshot for framework integration.
- Added typed hero, ability, upgrade, and inventory artwork helpers, a deduplicating current-upgrades selector, public capability helpers, and deterministic complete demo-state fixtures.
- Added a strict `backendUrl` escape hatch while keeping standard backend selection typo-safe.
- Made settings synchronization explicit and offline-friendly by default, persisted custom endpoints, made lifecycle hooks opt-in, and memoized generated resolved-settings values.
- Classified permanent broker HTTP failures as non-retryable `CONFIGURATION` errors with the response status.
- Made `watch()` use `Object.is()` by default and accept an explicit comparator, avoiding unconditional deep clones and comparisons in rendering paths.
- Generated recursively partial delivered-settings types and typed immutable defaults resolvers for database-bound applications.
- Added acknowledged host-command and match-score variants and captured the authenticated application-launch context used by the host bridge.
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
