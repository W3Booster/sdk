# Release and compatibility policy

W3Booster v2.0 supports one current application contract. SDK 2.0 uses protocol
2.0; it does not negotiate the retired protocol 1 or preserve development SDK
aliases. Publish the SDK and update the platform, generated bindings, and apps as
a coordinated release. Applications consume registry artifacts; packed SDK HEAD
is the development verification lane.

The hydrated state always contains `gameContext.hudScale`; the producer uses 1
when no measurement exists. Optional `chatbarOpen` and `teamColors` are delivered
when known. None requires a scope. Scores are application-owned data.
`overlay:read`, `overlay.runtime`, `overlay.misc`, and `overlay.settings` are
removed. Recorder discovery travels in private `transport.recorderUrls`; the SDK
consumes it before stripping the transport branch from public state.

Use `openClient` / `client.open` / `app.open` for transport readiness and
`startClient` / `client.start` / `app.start` for synchronized startup. The old
`connect` aliases and unstructured `error` event are removed. Observe `issue` and
the lifecycle store. Configure origins through `backend` and `backendUrl`.
Host actions require explicit capability discovery; an unsupported or malformed
response never enables controls. Typed `host.command` results require `parse`;
unparsed acknowledgements return `unknown`. Match Vision score commands and
capabilities are no longer SDK primitives.

Use `/standard-game/icons` and `/standard-game/cooldowns` for optional datasets.
The combined `/standard-game/objects` entry is removed. SDK data can evolve with
supported Warcraft patches; map-specific custom data is outside that contract.

The prerelease cleanup does not remove migration of pre-v2 production data.
Database settings, grants, orders, entitlements, and other persisted user data
must retain explicit, tested migration paths. Seeding, catalog preparation,
release checks, and immutable hosted artwork/release URLs remain supported.

Future breaking public changes require a documented version transition. Within
a protocol major, unknown additive fields are preserved. Public TypeScript models
retain spelling safety; JSON overlay extensions enumerate their branches and
cannot reuse the retired reserved names `runtime`, `misc`, or `settings`.
Delivered state is deeply immutable. Error recovery, resynchronization, and the
supported browser matrix remain part of the current contract.

The SDK remains framework-neutral and supports the browser versions declared in
`package.json`. Test runtime contracts, declarations, packed consumers, and browser
execution before publishing. A local link is not evidence of a registry release.
