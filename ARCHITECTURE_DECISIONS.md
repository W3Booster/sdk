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

Revisit the JavaScript choice when a planned migration can preserve package output, browser compatibility, and reviewable diffs.

## ADR-003: Make generated application runtimes canonical without deleting advanced APIs

Status: accepted, 2026-08-19.

Generated `w3boosterApp.createRuntime()` plus its atomic lifecycle store is the primary frontend path. Low-level `createClient`, `openClient`, and related client/store methods remain supported as advanced and compatibility APIs. Documentation should lead with the generated runtime and move lower-level construction later; it should not repeatedly rename or remove lifecycle methods outside a planned major migration.

The runtime exposes its read-only lifetime `AbortSignal`. Client event subscriptions and other runtime-owned frontend work should use that signal so `runtime.stop()` is the complete teardown boundary. SDK 1 consumers may feature-detect the signal and retain a temporary explicit unsubscribe fallback.

The runtime lifecycle is an atomic aggregate of client lifecycle, resolved settings, and host lifecycle. Client teardown changes the underlying client and host stores synchronously but separately; the aggregate batches that paired terminal transition and never publishes either half-updated combination. Standalone connected clients with an unavailable host remain valid and are not hidden.

`open()` means a transport is open, `whenReady()` may use preserved state, and `whenSynchronized()` means fresh complete state is renderable. `connect()` remains a deprecated alias.

## ADR-004: Preserve immutable identity and contain consumer failures

Status: accepted, 2026-08-19.

SDK stores publish immediately on subscription, use immutable structurally shared snapshots, support abort-scoped subscriptions, and lazily subscribe derived stores to their source. Selectors and equality functions may fail without corrupting the store: the error is routed through `onError`, the last valid selection is retained, and later valid updates can recover. Subscriber failures never block other subscribers. A selector that fails during initial construction is reported and rethrown because no valid value exists.

If an eager source emits its current value and then a real change synchronously while subscription is being established, a selector-store subscriber receives the latest selected value exactly once. The final immediate delivery must not duplicate that synchronous publication.

Only the single eager callback establishing a source subscription may be suppressed. Later source notifications must re-run the selector even when the source snapshot has identical object identity: `client.state` intentionally uses such notifications for synchronization-freshness changes while preserving immutable state identity.

Because derived stores unsubscribe lazily while idle, restarting the source subscription also forces one derivation even when the eager source snapshot has the same identity. This recovers freshness metadata that may have changed while no derived listener was present.

React adapters suppress only an eager callback containing the same snapshot captured before subscription. A genuine synchronous change during subscription must notify React.

## ADR-005: Validate host boundaries and serialize settings mutations globally

Status: accepted, 2026-08-19.

All setting mutations share one SDK queue. This preserves caller order for identical, parent, child, and unrelated setting paths; per-path queues are insufficient because `observer` and `observer.layout` overlap. App-owned optimistic UI may additionally serialize its own intent while supporting the published SDK 1 contract.

Unparsed generic host commands return `unknown`. A caller receives a typed result only through an explicit parser that validates the host response. This is a deliberate SDK 2 breaking correction.

Automatic capability discovery is tolerant so older hosts do not create unhandled failures. Explicit public `refreshCapabilities()` rejects timeouts, invalid responses, and host failures after moving capability state to a safe non-enabled status. Do not make the public operation silently tolerant again.

An initiating per-call `open()` cancellation leaves the client in `closed`, with null unsynchronized state; it must not remain visibly `connecting`. Explicit `refreshCapabilities()` without an authenticated host rejects `HOST_UNAVAILABLE`, while the private automatic discovery path remains tolerant.

## ADR-006: Treat compatibility and publication as separate facts

Status: accepted, 2026-08-19.

The current SDK tree is prepared as 2.0.0 but is not thereby published. A sibling symlink is not evidence that an npm consumer can use SDK 2. Match Vision therefore keeps its published SDK 1 dependency and explicit compatibility behavior until SDK 2 is actually released, while CI tests both the minimum registry version and a packed SDK HEAD artifact.

After publication, upgrade consumers and remove compatibility branches in one coordinated change. Do not alternately bump and roll back consumer ranges based only on the local symlink.

Legacy `localApi` and `cloudApi` options are deprecated in favor of `backend` and `backendUrl`, but remain for SDK 1 configuration compatibility. Removal requires a future intentional major migration.

## ADR-007: Promote reusable primitives, not Match Vision policy

Status: accepted, 2026-08-19.

The SDK owns the shared primitives revealed by Match Vision: complete head-to-head tuple selection, canonical team ordering for head-to-head/team/FFA modes, launch-aware icon and country-flag resolution, player display identity, lifecycle observation, resolved settings, cooldown/resource/stat derivation, and globally ordered host settings writes.

Match Vision keeps username/nationality overrides, player/observer profile precedence, match-scoped reverse-order persistence, local history retention, localized race/status text, sprite geometry, avatar-cover calculations, optimistic controls, and Angular signal/DI wiring. Small wrappers around SDK calls are allowed when they form an app-domain boundary; their existence alone does not justify another SDK API.

Promote more app code only after a second consumer demonstrates the same semantics or the behavior is required by protocol/security correctness.

## ADR-008: Normalize mixed and incomplete input safely

Status: accepted, 2026-08-19.

Modern `overlay.runtime` and legacy `overlay.misc` may coexist; validate and merge both, with modern runtime values winning. Frontends must tolerate incomplete scoped player data, so a head-to-head pair is nullable until exactly two players exist. Reverse team ordering applies to every supported team count, including FFA.

When BattleTag discriminator stripping is requested, both the in-game name and account name are normalized before choosing the primary display name. These are behavioral guarantees, not application workarounds.
