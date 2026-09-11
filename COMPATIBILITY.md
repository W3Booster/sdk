# Release and compatibility policy

SDK 3.x uses protocol 3.0. It does not negotiate protocol 2 or preserve the
previous unit, hero, statistics, or timer shapes. SDK 3.1 adds illusion flags,
selector options, and optional hero ordering without requiring existing SDK 3.0
applications to upgrade. The current platform supplies `isIllusion` on observed
entities; new application-owned typed fixtures must include that boolean.
Applications consume registry artifacts; packed SDK HEAD is the development
verification lane.

The applied-HUD-scale change requires a coordinated recorder/SDK update.
Current native `W3HudScale.value` is a finite multiplier in 0.5–1.0, and
`W3Game.initialRuntime.hudScale` provides the initial value to the platform.
The previous 0–128 encoding and `hudScaleRaw` initial field are removed. Older
SDKs misinterpret float recorder updates; rebuild bundled first-party consumers
with this SDK before enabling the new native library. Public protocol 3
`gameContext.hudScale` keeps the same shape and meaning. No value-based legacy
format detection or percentage reconstruction is performed.

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

### Additive API changes do not require an SDK upgrade

An app can keep its installed SDK version when the API adds optional attributes
to state objects, including nested match, player, hero, resource, game-context,
and application data. The SDK validates fields it knows and preserves other safe
JSON fields in immutable snapshots. It does not interpret those new fields.
Preservation is intentional: later patches can replace or remove an attribute
that the installed SDK does not know. Private `transport` metadata stays hidden.
New fields can trigger ordinary state/change subscriptions; they are not stripped
or guaranteed to be invisible to selectors that compare whole objects.

The broker and stream accept later minor versions of protocol 3, such as `3.1`.
Unknown stream events maintain sequencing and are delivered only to explicit
`onUnknown` subscribers. Additional advertised data capabilities are accepted;
unknown host capabilities are filtered out rather than enabling unsupported
actions. Requesting a new scope or using a new typed SDK method can require an
SDK upgrade even though existing applications continue working.

| API change | Existing SDK behavior |
| --- | --- |
| Add an optional JSON attribute to an existing object | Accepted and preserved |
| Patch a previously unknown attribute | Applied normally |
| Add a stream event or capability | Does not break existing data consumption |
| Add a protocol minor version | Accepted within the supported major |
| Remove a required field or change an existing field's type | Rejected |
| Add a value to a closed enum, such as match status, race, result outcome, or application surface | Rejected by SDKs that do not recognize it |
| Add a patch operation beyond `add`, `replace`, and `remove` | Rejected |
| Reuse a retired reserved field or send unsafe object keys | Rejected |
| Change protocol major | Requires an explicit version transition |

API producers must preserve the types, meanings, required fields, and closed-enum
values of the supported contract. A new enum member is not an additive attribute.
Use an optional new field or an explicitly negotiated new contract for new
semantics; do not send an unknown outcome and assume old apps will ignore it.
Older SDKs also cannot promise typed helpers or validation for newly added fields.
Apps that only use existing fields need no dependency or generated-binding update.
Changes to an app's own definition revision still require regenerating its binding;
that is separate from a platform adding state attributes.

`test/forward-compatibility.test.mjs` exercises additive snapshots, nested patches,
minor versions, unknown event sequencing, and the incompatible boundaries through
the public client. These tests run in the normal SDK test suite.

The SDK remains framework-neutral and supports the browser versions declared in
`package.json`. Test runtime contracts, declarations, packed consumers, and browser
execution before publishing. A local link is not evidence of a registry release.
