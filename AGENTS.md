# SDK architecture guidance

`@w3booster/sdk` is a framework-neutral browser SDK.

- Do not add Angular-, React-, Vue-, Svelte-, or other framework-specific runtime implementations to the SDK core.
- Prefer standards-based contracts such as immutable snapshots, immediate stores, subscriptions, `AbortSignal`, and plain ESM functions that every frontend can adapt.
- A framework-named entry point is acceptable only when it remains dependency-free and adapts a framework-owned standard contract without importing that framework. The existing React external-store adapter is the reference example.
- Keep application-specific UI state, localized messages, dependency injection, component lifecycle hooks, and presentation policy in the consuming application.
- Promote protocol, Warcraft III, security/privacy, transport, lifecycle, and cross-application presentation rules into the SDK when they must behave consistently for every consumer.
- Keep optional transports, demo fixtures, and large static datasets out of the eager application path when they can be loaded on demand.
