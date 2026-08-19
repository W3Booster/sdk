# SDK architecture guidance

`@w3booster/sdk` is a framework-neutral browser SDK.

Read `ARCHITECTURE_DECISIONS.md` before proposing architectural changes. It records the tradeoffs already made during repeated SDK/Match Vision reviews. A decision may be revisited when its stated assumptions change or new evidence appears, but do not reverse it merely because another design is also reasonable.

- Do not add Angular-, React-, Vue-, Svelte-, or other framework-specific runtime implementations to the SDK core.
- Prefer standards-based contracts such as immutable snapshots, immediate stores, subscriptions, `AbortSignal`, and plain ESM functions that every frontend can adapt.
- A framework-named entry point is acceptable only when it remains dependency-free and adapts a framework-owned standard contract without importing that framework. The existing React external-store adapter is the reference example.
- Keep application-specific UI state, localized messages, dependency injection, component lifecycle hooks, and presentation policy in the consuming application.
- Promote protocol, Warcraft III, security/privacy, transport, lifecycle, and cross-application presentation rules into the SDK when they must behave consistently for every consumer.
- Keep optional transports, demo fixtures, and large static datasets out of the eager application path when they can be loaded on demand.
- Author public types and value signatures in the contracts under `api-source/`, runtime implementations in the matching `src/*.runtime.js` files, and version literals in `api-source/version.ts`. The forwarding `api-source/{index,selectors,store,app,standard-game,assets}.ts` facades are generated from exported contract values; do not edit them directly. Run `npm run build:api` to refresh facade sources and package output. `npm run check:api` verifies that both committed layers are current.
- Keep the JavaScript runtime graph compatible with `npm run check:runtime`; it enables TypeScript `checkJs` over the public runtime modules and their imported implementation graph.
