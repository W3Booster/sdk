# SDK architecture decisions

This file prevents repeated reviews from oscillating between equally plausible designs. These decisions are not immutable: change one when constraints have changed or new evidence invalidates an assumption. A change should update this file with the reason and migration path. Reviewers should still report bugs or violations of a decision, but should not report the documented tradeoff itself as a new finding without explaining the new evidence.

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
