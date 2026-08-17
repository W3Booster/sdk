# Changelog

## 0.2.0 - 2026-08-17

- Renamed the observer/replay low-latency option to `localRecorder` and its active diagnostic value to `recorder-local`.
- Made explicit disconnect clear state and diagnostics while preserving subscriptions for a clean reconnect.
- Moved W3Booster compositor infrastructure to `@w3booster/sdk/compositor`.
- Moved custom transport types and the demo transport factory to `@w3booster/sdk/testing`; normal app demo mode remains `connect({ demo: true })`.
- Expanded lifecycle, capability, error, troubleshooting, settings, and browser-support documentation.
- Made concurrent connections single-flight, added initial connection cancellation, and bounded WebSocket handshakes.
- Stopped disconnected recorder caches from masking newer platform snapshots and decoupled recorder game time from overlay presentation settings.
- Made compositor watches renew expired sessions and reauthorize every reconnect.
- Aligned runtime validation with the declared match, player, hero, resources, statistics, and application state types.
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
