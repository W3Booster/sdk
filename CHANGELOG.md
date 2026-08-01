# Changelog

## Unreleased

## 0.1.1 - 2026-08-01

- Switched automated releases from a long-lived npm token to GitHub Actions trusted publishing with OIDC and automatic provenance.
- Kept backend URL validation deterministic in runtimes without a native WebSocket implementation.

## 0.1.0 - 2026-08-01

- Added pure live-state selectors under `@w3booster/sdk/selectors` for active matches, explicit broadcaster lookup, team grouping with IDs, player relationships, hero inventory, and BattleTag display names.
- Added the optional `@w3booster/sdk/standard-game` namespace with immutable shipped Warcraft III object metadata and typed helpers for rawcodes, cooldowns, races, colors, melee modes, hero progression, and weapon/armor upgrades.
- Added safe, versioned Classic/Reforged icon URL helpers and an overridable asset base URL. Warcraft artwork remains outside the npm package.
- Added the complete generic public match-state model and typed application settings.
- Added `client.state`, `whenReady()`, string-form `connect(clientId)`, and `host.setSetting()` while preserving the previous API aliases.
- Added explicit SDK and protocol versions plus protocol negotiation.
- Added runtime envelope/state validation, message-size limits, safe JSON Patch handling, and application-identity checks.
- Refuse insecure remote API and WebSocket endpoints so credentials are only sent over encrypted connections; plain HTTP/WS remains available on localhost for development.
- Isolated application listeners and rejected non-JSON transport values so consumer errors cannot interrupt state delivery.
- Apps now use the scopes configured in their application record by default.
- Removed the obsolete direct channel/secret data transport; browser-source credentials only authenticate the compositor.
