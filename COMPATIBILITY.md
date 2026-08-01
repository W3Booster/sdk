# Compatibility policy

`@w3booster/sdk` uses Semantic Versioning for its public JavaScript and TypeScript API. Existing methods are deprecated before removal and remain available for at least one stable major-version transition. Additive model fields and events do not require an SDK major release.

Although the package is currently pre-1.0, minor releases follow the same backwards-compatibility expectation. A breaking change requires an explicit migration path and release note; it is not hidden in a feature or patch release.

The realtime protocol is versioned separately. Protocol `1.x` is additive: existing field meanings do not change, unknown fields and events may be added, and compatible SDKs preserve them. A future protocol major must be negotiated during stream-ticket creation; the server never silently selects an unsupported major.

Application code should import the public model from `@w3booster/sdk`, avoid matching on unknown fields exhaustively, and treat delivered state as immutable. The backend producer and first-party applications compile against the same declarations.

Pure derived-state conveniences are exposed from `@w3booster/sdk/selectors`. Selectors never mutate delivered state. Additions are backwards compatible; existing selector meanings follow the same deprecation policy as the main entry point.

Static Warcraft III standard-game knowledge is versioned with the SDK and exposed from `@w3booster/sdk/standard-game`. It is additive API, but its values may change in a minor release when W3Booster updates its supported dataset for a Warcraft III patch. Map-specific custom object data is outside that namespace's contract.

Hosted artwork has its own immutable catalog version in the URL, for example `wc3/standard-game/v1`. Existing files inside a released catalog are never replaced with different artwork or meaning. A new incompatible catalog uses a new URL version independently of the npm package version. Applications may replace the asset base URL without changing rawcodes or catalog paths.

The aliases `client.match`, `MatchStore`, `getState()`, and `getPlayer()` remain supported. New code should prefer `client.state`, `StateStore`, `get()`, and `player()`.
