# @w3booster/sdk

Browser SDK for realtime W3Booster match data in applications and overlays. It handles app authorization, transport selection, reconnects, protocol validation, patches, and immutable hydrated state.

## Quick start

```sh
npm install @w3booster/sdk
npx w3booster-settings init app_your_id
```

```ts
import { w3boosterApp } from './w3booster.generated';

const runtime = w3boosterApp.createRuntime({ retry: true });
runtime.lifecycle.subscribe(snapshot => {
  renderConnection(snapshot.status, snapshot.error);
  render(snapshot.state, snapshot.settings, snapshot.host);
});

await runtime.start();

// When the page or component is disposed:
await runtime.stop();
```

The client ID is the public, immutable identifier generated when an app is created in W3Booster. It is not a secret. The one-time `init` command creates a checked-in typed binding for that application definition. The managed runtime publishes connection status, synchronized state, resolved settings, and host capabilities atomically; normal applications do not pass connection URLs, credentials, or scopes.

Use `demo: true` when W3Booster is not running. Demo support is loaded on demand and stays out of normal production startup:

```js
const runtime = w3boosterApp.createRuntime({ demo: true });
await runtime.start();
```

The built-in demo includes representative players, resources, heroes, upgrades, statistics, control groups, overlay runtime, and application metadata. Supply typed settings without constructing a complete state:

```ts
const client = await startClient<Settings>({
  clientId: 'your_app_id',
  demo: { settings: { layout: 'wide' } }
});
```

Set `interval: 0` for a static deterministic fixture, or pass `state` to replace the complete demo state.

For real data during development, run the app on localhost and use **Apps → Developer → My apps → Test locally**. The temporary session supplies real credentials and replaces only your app surfaces. Application code remains unchanged.

W3Booster reserves the URL fragment for its short-lived launch credential; opening a client consumes it and cleans the visible address. Use normal History API paths or query parameters for application routing instead of hash routing.

W3Booster Cloud is the default backend. A platform-provided `?backend=local` or `?backend=cloud` launch parameter is handled by the SDK automatically; application code must not parse or forward it. Platform developers can force the local API explicitly:

```js
const client = await startClient({
  clientId: 'your_app_id',
  backend: 'local'
});
```

`backend: 'auto'` tries local and then cloud. A complete HTTPS URL in `backendUrl` selects another platform environment. Keeping URL selection separate from `backend: 'local' | 'cloud' | 'auto'` lets TypeScript catch misspelled standard backends. Remote HTTP and WebSocket endpoints must use HTTPS/WSS; unencrypted HTTP/WS is accepted only for localhost.

Platform integrations that explicitly provide a `tokenProvider` should return the current credential. The SDK calls it for every broker ticket request, including reconnects, so refreshed credentials are used automatically. Normally launched applications do not need this option.

## State lifecycle

`start()` and top-level `startClient()` are the canonical long-lived frontend entry points and resolve with synchronized state by default. `open()` and top-level `openClient()` explicitly stop at transport readiness. The older `connect()` names remain deprecated aliases for `open()` so existing applications keep working. Use `whenReady()` when work only needs any hydrated snapshot, including preserved state during reconnect. Use `whenSynchronized()` when rendering or an action must wait for a fresh snapshot from the current connection:

```js
const initialState = await client.whenReady(); // 10-second default timeout
const freshState = await client.whenSynchronized();
```

Use `createClient()` when the UI needs to observe the complete lifecycle, including the initial `connecting` and retry states. Attach listeners first, then connect:

```js
import { createClient } from '@w3booster/sdk';

const lifetime = new AbortController();
const { signal } = lifetime;
const client = createClient({ clientId: 'your_app_id', retry: true, signal });
client.lifecycle.subscribe(snapshot => {
  renderConnectionStatus(snapshot.status);
  render(snapshot.state, { fresh: snapshot.isSynchronized });
  if (snapshot.error) report(snapshot.error);
}, { signal });

await client.start({ signal });
```

`start()` defaults to synchronized state with no timeout and rejects if synchronization becomes permanently impossible. Its optional signal cancels transport opening and readiness together and closes an incomplete startup. Pass `{ until: 'connected' }` for a transport-only startup or an explicit `timeout` when the UI wants a bounded wait. Runtime construction is intentionally rejected; use `openClient()`, `startClient()`, or `createClient()` so internal mutable stores and transports remain encapsulated behind frozen read-only facades.

Generated application runtimes share transport opening, but each concurrent `runtime.start()` call keeps its own readiness milestone, timeout, and cancellation. Cancelling one runtime startup wait does not disconnect another caller or the runtime lifetime; call `runtime.stop()` for shared teardown.

`client.lifecycle` publishes connection status, current state, freshness, and the current connection/synchronization error as one snapshot. Non-fatal recorder and consumer-listener problems—including listeners attached to a generated application runtime—are published as structured `issue` events without turning healthy match data into a connection failure. The legacy untyped `error` event mirrors issues for compatibility and is deprecated for new integrations. The lifecycle store is the preferred UI integration point when its values feed one view model. The narrower `state.subscribe()`, `subscribeStatus()`, and event APIs remain useful when a feature needs only one stream.

`client.state` is the authoritative source of current data:

- `get()` returns the current state or `null` before the first snapshot.
- `isSynchronized` reports whether that state has a complete baseline from the current connection.
- `player(id)` returns one current player or `null`.
- `subscribe(listener)` runs immediately and after every update, reset, or synchronization-freshness change; its value is `null` while no hydrated state is available. A freshness-only notification retains the same state identity, so read `client.state.isSynchronized` from the store when handling it.
- `watch(selector, listener)` reevaluates immediately, including while state is unavailable, and after those same transitions; the listener runs when `Object.is()` detects a new selection. Pass `{ equals }` for value-based comparison. A selector may read `client.state.isSynchronized` when freshness is its selected value.
- Every subscription method returns an unsubscribe function.

Hydrated state is recursively immutable. Patches and recorder updates use structural sharing, so untouched matches, players, heroes, settings, and extension branches keep their object identity. Consumers may use referential equality to avoid unnecessary work while continuing to identify rendered entities by their domain IDs. Allocation-heavy SDK selectors also retain their result identity when called again with the same frozen SDK collections.

The initial snapshot emits `state.ready` and `state.changed`. Match, player, and hero domain events describe changes after that snapshot; they are not a replacement for rendering initial state. In particular, an already-running match does not synthesize `match.started` when the app opens.

```js
const stopClock = client.state.watch(
  state => state?.match.gameTime ?? null,
  (seconds, previousSeconds) => drawClock(seconds, previousSeconds)
);

client.on('match.started', ({ match }) => showNewMatch(match));
client.on('player.resources.changed', ({ player, resources }) => updateEconomy(player.id, resources));
client.on('hero.changed', ({ player, hero }) => updateHero(player.id, hero));
client.on('issue', issue => console.warn(issue.source, issue.recoverable, issue.error));
```

`client.status` is the current connection state. `subscribeStatus()` immediately reports it and then reports transitions such as `reconnecting`, `connected`, and `error`; the lower-level `status` event reports transitions only. Automatic network reconnects preserve hydrated state for continuity, set `state.isSynchronized` to `false`, and hold patches until a fresh snapshot re-establishes a complete baseline. A complete forward snapshot can establish that baseline directly across a sequence gap; the SDK emits `stream.gap` but does not request a redundant resync. An explicit `disconnect()` closes transports, rejects pending readiness waits, and clears state and diagnostics; existing subscriptions remain registered if the same client is connected again.

### Resilient frontend lifecycle

Generated application bindings provide the shortest framework integration. Their managed runtime combines connection state, synchronization freshness, resolved settings, and reactive host capabilities into one immediate snapshot and owns teardown:

```ts
import { canUseHostCapability } from '@w3booster/sdk';
import { w3boosterApp } from './w3booster.generated';

const runtime = w3boosterApp.createRuntime({ retry: true });

runtime.lifecycle.subscribe(snapshot => {
  renderConnection(snapshot.status, snapshot.error);
  render(snapshot.state, snapshot.settings);
  toggleWindowAction(canUseHostCapability(snapshot.host, 'window:open'));
});

await runtime.start();
// Angular destroy, React cleanup, Vue unmount, or page teardown:
await runtime.stop();
```

Use the lower-level client lifecycle when a project is not database-bound or deliberately needs to manage subscriptions separately.

One `AbortController` can own the connection, readiness wait, and subscriptions for a component or application. Aborting it cancels connection/retry work, disconnects an established client, settles pending readiness waits, and removes subscriptions:

```js
const controller = new AbortController();
const { signal } = controller;

const client = createClient({
  clientId: 'your_app_id',
  retry: true,
  signal
});

client.state.subscribe(state => renderConnectionState(state), { signal });
client.on('issue', issue => report(issue.error, issue), { signal });
await client.open();
await client.whenSynchronized({ signal });

// React effect cleanup, Angular destroy, Vue unmount, or page teardown:
controller.abort();
```

`retry: true` retries transient initial connection failures with capped exponential backoff. An unlimited policy requires either the connection lifetime signal or the signal supplied to `start()` for that incomplete startup. Calling `open()` without either signal rejects before connecting. Authorization, configuration, and protocol failures fail immediately. Initial retries remain in `connecting`; `reconnecting` is reserved for a previously established transport. During an initial retry, `client.lifecycle.get().retry` exposes its attempt, configured attempt limit (`null` means unlimited), last transient error, and next delay (`null` while the attempt is underway), so a frontend can explain progress without parsing errors. It returns to `null` after success, terminal failure, or cancellation. Use `retry: { maxAttempts: 5, initialDelay: 250, maxDelay: 5000 }` for a bounded policy that does not require a signal. The default remains one initial attempt so command-line tools and explicit error screens fail promptly.

After an established broker socket closes, transient reconnects use their own policy and permanent configuration, authorization, and protocol failures transition to `error`. The default is unlimited capped reconnects. Pass `reconnect: false` to fail immediately or `reconnect: { maxAttempts: 5, initialDelay: 500, maxDelay: 10000 }` for a bounded policy.

Concurrent `open()` calls on the same client share one attempt. All cancellation rejects with the standard `AbortError` name. `subscribe()`, `subscribeStatus()`, `watch()`, `on()`, and `once()` still return explicit unsubscribe functions when a signal is not convenient.

## Scopes and capabilities

An application requests scopes in its W3Booster metadata. The server filters every snapshot to the granted scopes. Passing `scopes` when opening a client can only request a smaller subset.

| Scope | Capability | Conditional state |
| --- | --- | --- |
| `match:read` | `match` | Match lifecycle, time, map, mode, realm, and broadcaster IDs |
| `players:read` | `players` | Player identity, race, team, color, and position |
| `stats:read` | `stats` | Ranking statistics and main-account data |
| `heroes:read` | `heroes` | Heroes, health, mana, abilities, and inventory |
| `upgrades:read` | `upgrades` | Completed, active, and researching upgrades |
| `resources:read` | `resources` | Gold, lumber, supply, and worker supply |
| `controlgroups:read` | `controlgroups` | Control-group front units and sizes |
| `overlay:read` | `overlay` | Public overlay runtime values |

A granted scope does not guarantee that data exists in every match or account context. Check `state.capabilities` and keep conditional fields optional:

```js
client.state.subscribe(state => {
  if (!state) return;
  const canShowResources = state.capabilities.includes('resources');
  const resources = canShowResources ? state.players[0]?.resources : undefined;
  renderResources(resources);
});
```

## Events

Useful events include:

- `state.ready`, `state.changed`
- `match.started`, `match.changed`, `match.ended`
- `player.added`, `player.changed`, `player.removed`
- `player.resources.changed`, `player.stats.changed`, `player.upgrades.changed`
- `hero.added`, `hero.changed`, `hero.removed`
- `hero.inventory.changed`, `hero.abilities.changed`
- `application.settings.changed`
- `status`, `issue`, the deprecated compatibility `error`, and `stream.gap`

`on()` and `once()` return unsubscribe functions. Listener failures are isolated and forwarded to the structured `issue` event (and mirrored to deprecated `error` listeners) so one application callback cannot interrupt state delivery.

Event payloads are immutable and shared safely between listeners. Async listener promises are observed for rejection but do not delay or serialize later events; applications that require ordered asynchronous work should queue it explicitly inside the listener.

## Typed application settings

Settings defined in application metadata are delivered as `state.application.settings`. Type the settings once and the state, events, and store inherit that type:

```ts
interface Settings {
  layout: 'compact' | 'wide';
  showHeroes?: boolean;
}

const client = await startClient<Settings>('your_app_id');

client.state.subscribe(state => {
  const settings = state?.application?.settings;
  if (settings) setLayout(settings.layout);
});
```

Settings and extension models are checked recursively for JSON compatibility. `Date`, `Map`, functions, class instances, and similar values are rejected by TypeScript at client creation as well as by runtime ingress validation.

`client.host.setSetting(path, value)` resolves with the complete saved settings only after W3Booster confirms persistence. It rejects with `HostActionError` when the platform rejects the write, or `ConnectionError` when the host is unavailable or does not answer. The normal `application.settings.changed` event still updates every open surface.

With typed settings, setting paths—including nested dot paths—and their values are checked by TypeScript:

```ts
interface Settings {
  observer?: { layout: 'compact' | 'wide'; showHeroes?: boolean };
}

const client = await startClient<Settings>('your_app_id');
const saved = await client.host.setSetting('observer.layout', 'wide');
// client.host.setSetting('observer.layout', 'large'); // TypeScript error
```

The event's `settings` and `previousSettings` values can be `undefined` when application state is added or removed. Hydrated state and settings are recursively read-only in TypeScript because the SDK freezes delivered state at runtime.

## Errors and troubleshooting

Handle initial connection failures around `startClient()` and later non-fatal stream or listener problems with the structured `issue` event:

```js
import {
  startClient,
  ConnectionError,
  HostActionError,
  isAbortError,
  PermissionRequiredError,
  ProtocolError
} from '@w3booster/sdk';

try {
  const client = await startClient('your_app_id');
  client.on('issue', ({ error, source, recoverable }) => {
    console.warn({ source, recoverable });
    if (error instanceof ProtocolError) console.error(error.code, error.details);
    else console.error(error);
  });
} catch (error) {
  if (error instanceof PermissionRequiredError) {
    showMessage('Enable and open this app from W3Booster.');
  } else if (error instanceof ConnectionError) {
    console.error(error.code, error.message, error.causes);
  } else if (error instanceof HostActionError) {
    showMessage(error.message);
  } else if (isAbortError(error)) {
    // Normal component or page teardown.
  } else {
    throw error;
  }
}
```

Common causes:

- **Permission required:** the URL was opened directly, the app is disabled, or its temporary development session expired.
- **Outdated generated binding:** regenerate and redeploy the application when the broker reports `APPLICATION_DEFINITION_MISMATCH`.
- **No initial state:** `whenReady()` timed out before the platform supplied a snapshot.
- **Local connection failure:** trust the W3Booster localhost certificate and verify the local backend is running.
- **Protocol error:** inspect `ProtocolError.code`; recoverable invalid state or patch data requests a resync. Unsupported protocol versions and application mismatches are permanent and close the active transport. A complete forward snapshot is accepted as the new baseline across an ordinary sequence gap.
- **Missing fields:** verify the application scope, the matching capability, and whether that data exists for the current match.

`ConnectionError.code` is stable for programmatic handling (`UNAVAILABLE`, `CONFIGURATION`, `APPLICATION_DEFINITION_MISMATCH`, `MISSING_BROWSER_API`, `BROKER_TIMEOUT`, `STARTUP_TIMEOUT`, `STATE_TIMEOUT`, `HOST_UNAVAILABLE`, or `HOST_TIMEOUT`). `STARTUP_TIMEOUT` means a managed runtime did not reach its requested lifecycle milestone within the caller's whole-startup deadline; `STATE_TIMEOUT` means an established client did not receive the requested state in time. Configuration and application-definition mismatch failures are never retried; their optional `status` carries the HTTP status. `isAbortError()` recognizes lifecycle cancellation, and `isW3BoosterError()` recognizes every SDK error class. `HostActionError` represents an acknowledged platform rejection rather than a transport failure.

Frontends that prefer one discriminated branch can use `classifyW3BoosterError(error)`. It returns a stable `kind`, `code`, and original `error`, plus `status` or `authorizeUrl` when available, without imposing application-specific user-facing copy.

The package targets Chrome/Chromium 92+, Edge 92+, Firefox 90+, and Safari 15.4+ and requires native ESM, `fetch`, `WebSocket`, and `AbortController`. OBS browser sources must embed Chromium 92 or newer. Node.js is supported for tooling and tests; realtime Node usage must provide an appropriate WebSocket environment or a testing transport.

## Low-latency recorder data

During active observer and replay matches, the SDK automatically consumes the local recorder socket advertised by authenticated platform state. The platform remains authoritative for identity, permissions, settings, capabilities, and the initial snapshot; the local socket overlays volatile match values such as game time, HUD scale, resources, heroes, and upgrades without discarding platform-owned or additive metadata. If a socket does not open promptly, the SDK rotates through the advertised URLs and keeps retrying. If an active socket disconnects, cached recorder values stop overriding authenticated platform snapshots until the recorder reconnects and sends fresh data.

Recorder bursts are deduplicated and published at most once per display frame. Repeated values do not publish a new state, and unchanged state branches retain their references.

### Numeric and coordinate conventions

- `match.gameTime` is elapsed in-game time in whole seconds and excludes paused time.
- `match.map` is a human-readable, display-ready name; the SDK decodes producer transport escaping once at snapshot/patch ingress.
- `overlay.runtime.hudScale` is a CSS scale multiplier normalized by W3Booster from `0.5` through `1.0`. Apply it as a scale/zoom value; it is not a percentage.
- `player.startPosition` uses Warcraft III map coordinates, not pixels. It is suitable for relative map placement and player ordering; transforming it onto an image depends on that map's bounds.
- Gold, lumber, supply, and worker supply are already normalized player-facing values; applications do not divide recorder values themselves.
- `stats.*.winRate` is a percentage from `0` through `100`, ready to display with a percent sign.
- `hero.abilities[].lastActivation`, when present, is a positive millisecond timestamp on the match game-time clock; absence means the ability has not activated. Prefer `standardGameCooldowns.abilityCooldown()` instead of interpreting it directly.
- Upgrade `gametime` is the Unix timestamp in milliseconds when W3Booster observed the upgrade. Research start/finish values are ISO-8601 timestamps.

`match.started` and `match.ended` events include `observedAt`, an ISO-8601 client observation time. It is explicit receipt/transition timing, not an authoritative match timestamp; prefer `match.startedAt` and `match.endedAt` when the platform supplies them. When an active match with the same ID becomes `finished`, an ended event exposes that completed snapshot as `event.match`, so `event.match.endedAt` is directly available; `previousMatch` retains the active snapshot.

Use `client.subscribeMatchLifecycle()` when a feature needs both the match that is already active at hydration and later transitions. It reports `{ phase, initial, observedAt, match, state }`; `initial` distinguishes hydration/re-hydration from a later semantic transition. By default, a finished match in the first snapshot remains a baseline rather than a new event. History and audit consumers can pass `{ includeCurrentFinished: true }` to receive it once as `{ phase: 'ended', initial: true }`.

Only loopback and private-network socket addresses are accepted. Capabilities still control all exposed fields. Set `localRecorder: false` only when an application deliberately needs to disable this behavior. `client.diagnostics.localTransport` is `recorder-local` while it is active.

## Selectors

Pure state helpers live in `@w3booster/sdk/selectors`:

```js
import {
  broadcasterFirstTeams,
  broadcasterPlayer,
  groupPlayersByTeam,
  headToHeadPair,
  heroInventory,
  inventorySlotIdentity,
  matchScore,
  matchScoreOrZero,
  overlayRuntime,
  playerHeroes,
  playerDisplayIdentity,
  playerResources,
  playerResourcesOrZero,
  playerRelationship
} from '@w3booster/sdk/selectors';

const broadcaster = broadcasterPlayer(state.match, state.players);
const teams = groupPlayersByTeam(state.players);
const observerPlayers = headToHeadPair(state.players); // typed pair, or null until both players are scoped
const broadcasterTeams = broadcasterFirstTeams(state.players, state.match);
const relation = playerRelationship(state.players[0], state.match, state.players);
const inventory = heroInventory(broadcaster?.heroes?.[0]);
const runtime = overlayRuntime(state); // stable empty fallback when unavailable
const score = matchScore(state); // undefined when overlay score data is unavailable
const scoreForDisplay = matchScoreOrZero(state); // explicit stable 0-0 presentation fallback
const heroes = playerHeroes(broadcaster);
const identity = playerDisplayIdentity(broadcaster, {
  stripBattleTagDiscriminator: true
}); // account/in-game names plus hasAlias
const resources = playerResources(broadcaster); // undefined without scoped resource data
const resourcesForDisplay = playerResourcesOrZero(broadcaster); // explicit stable zero fallback
const itemKey = inventorySlotIdentity(0, inventory[0]);
```

Also available: `isActiveMatch()`, `battleTagName()`, `upgradeIdentity()`, and `currentUpgrades()`. Grouping, broadcaster, pair, and team-ordering selectors preserve input subtypes, so lightweight history and view-model records do not need application-side casts or regrouping. `playerDisplayIdentity()` centralizes account versus in-game naming semantics and offers an explicit numeric BattleTag-discriminator policy while applications retain localized formatting. Selectors keep common protocol-derived identity, grouping, and relationship logic out of individual applications. Standard-game presentation rules such as observer ordering and simplified team colors live in the separate namespace below.

Additive overlay branches can remain strictly typed without a catch-all index signature. Supply the extension model as the client's second generic; it is deeply read-only and propagates through state, lifecycle, and event payloads. The normalization-owned names `runtime`, `misc`, and `settings` are reserved and rejected as extension branches:

```ts
interface TournamentOverlay {
  readonly tournament: { readonly round: number };
}

const client = createClient<Settings, TournamentOverlay>({ clientId: 'your_app_id' });
const round = client.state.get()?.overlay?.tournament.round;

// Generated bindings expose the same generic:
const runtime = w3boosterApp.createRuntime<TournamentOverlay>();
```

## Warcraft III standard-game data

Lightweight Warcraft III rules live in `@w3booster/sdk/standard-game`. Icon metadata and cooldown metadata use separate opt-in entry points so frontends pay only for the data they use. The backwards-compatible combined object table remains available from `@w3booster/sdk/standard-game/objects`:

```js
import * as standardGame from '@w3booster/sdk/standard-game';
import * as standardGameIcons from '@w3booster/sdk/standard-game/icons';
import * as standardGameCooldowns from '@w3booster/sdk/standard-game/cooldowns';

const icon = standardGameIcons.iconUrl('Hamg', { graphics: 'reforged' });
const cooldown = standardGameCooldowns.abilityCooldown(ability, state.match.gameTime);
const cooldowns = standardGameCooldowns.abilityCooldownsForState(state); // frozen ReadonlyMap facade
const selectedCooldown = cooldowns.get(ability); // keyed by the hydrated ability object
// cooldowns and selectedCooldown are immutable; the facade has no set/delete methods
const progress = standardGame.heroExperienceState(heroState.experience);
const clock = standardGame.dayNightState(state.match.gameTime);
const gameTime = standardGame.formatGameTime(state.match.gameTime, { compactHours: true });
const stats = standardGame.preferredStats(player, state.match.mode);
const health = standardGame.valuePoolRatio(heroState.hitpoints);
const defeated = standardGame.isValuePoolDepleted(heroState.hitpoints);
const leftToRight = standardGame.orderHeadToHeadPlayers(players);
const presentationTeams = standardGame.orderMatchTeams(state.players, state.match, { reverse: false });
const presentationColor = standardGame.presentationPlayerColor(player, state.match, state.players, runtime);
const raceLabelKey = standardGame.raceInfo(player.race)?.localizationKey;
const displayLevel = standardGame.formatHeroLevelProgress(heroState);
const assets = standardGameIcons.createAssetResolver(); // launch-aware by default
const heroIcon = assets.hero(state.match, heroState);
const countryFlag = assets.countryFlag(player.mainAccount?.country);
```

Rawcode and typed entity helpers are strict: missing shipped metadata returns `undefined` rather than guessing a filename. Tooling that intentionally owns a catalog filename can opt into `iconFilenameUrl(filename)` explicitly.

The lightweight namespace includes upgrade classification, locale-neutral race identifiers and localization keys, player colors, melee modes, preferred statistics selection, game-time formatting, the day/night clock, hero progression, safe current/max ratios, standard upkeep classification, canonical mode-aware team ordering, and native or simplified presentation colors. Team ordering keeps the broadcaster first on player and team-observer surfaces, uses map positions for 1v1 observers/replays, and preserves FFA team order; explicit match mode prevents incomplete scoped state from being misclassified. Applications own translated race copy; the SDK does not choose a display language. The icon namespace adds Classic/Reforged URLs and a match-aware resolver; the cooldown namespace adds immutable individual and whole-state cooldown derivation. Custom maps can replace these objects and rules; live recorder values remain authoritative.

The trusted W3Booster server masks W3Champions four-player FFA opponent identities before issuing the scoped application stream. The current broadcaster remains identifiable; other players arrive with positional labels, random race, and no main-account metadata. Applications and the consumer-controlled SDK do not implement or enforce this privacy boundary.

Icons default to the immutable `https://static.w3booster.com/assets/wc3/standard-game/v1/` catalog. Pass `baseUrl` for a local asset mirror. The npm package contains metadata and URL helpers, not Blizzard artwork.

## Shared asset URLs

The match-aware resolver above binds the launch-selected asset host once for both standard-game icons and country flags. Lower-level reusable URL helpers remain available from `@w3booster/sdk/assets` when a frontend does not need Warcraft icons:

```js
import { countryFlagUrl, resolveAssetBaseUrl } from '@w3booster/sdk/assets';

const flag = countryFlagUrl(player.mainAccount?.country, {
  baseUrl: resolveAssetBaseUrl()
});
```

Country identifiers are trimmed and normalized to lowercase. Flags default to the immutable `https://static.w3booster.com/assets/country-flags/v1/` catalog. `resolveAssetBaseUrl()` safely consumes the host-owned `assetBaseUrl` launch parameter only when W3Booster selects the local backend and advertises a loopback mirror; an explicit validated `baseUrl` still takes precedence. The artwork remains outside the npm package.

## Host actions

Embedded surfaces can ask W3Booster to perform supported host actions:

```js
await client.host.openWindow({ path: '?view=compact', width: 520, height: 620 });
await client.host.closeWindow();
await client.host.changeMatchScore('wins', 1);
await client.host.resetMatchScore();
const settings = await client.host.setSetting('observer.layout', 'wide');
const accepted = await client.host.command('application.preview', undefined, {
  parse(value) {
    if (!value || typeof value !== 'object' || value.accepted !== true) {
      throw new TypeError('Invalid preview acknowledgement');
    }
    return value.accepted;
  }
});
```

Every asynchronous host method accepts action options at its final argument, so pending acknowledgements can share a feature or component lifetime and use a shorter timeout when appropriate:

```js
const feature = new AbortController();
await client.host.changeMatchScore('wins', 1, { signal: feature.signal, timeout: 3000 });
feature.abort(); // cancels any later pending feature actions
```

`client.host.available` becomes `true` after an authenticated connection inside a captured W3Booster application launch. Browser responses must come from the launch's embedding origin; Electron windows use the injected host bridge. Every action waits for a host acknowledgement and rejects when delivery, execution, cancellation, or timeout fails; use `void client.host.openWindow(...)` only when a view deliberately does not need to await it. Named window and score actions resolve with `void`. Generic `command()` results remain `unknown` unless a parser validates and transforms the host acknowledgement. A capability refresh starts automatically after authentication. `host.can(capability)` is a synchronous read for imperative code. Reactive UIs should subscribe to `host.lifecycle` and call `canUseHostCapability(snapshot, capability)`, or consume `snapshot.host` from a generated application runtime, so controls update when discovery completes. Both distinguish pending discovery and explicit unsupported actions while preserving compatibility with `legacy` hosts that cannot advertise capabilities. `host.capabilityStatus`, `capabilities`, `supports()`, and `subscribeCapabilities()` expose lower-level reads. Call `refreshCapabilities()` only when an explicit refresh is needed. Settings writes are serialized globally because parent and child paths may overlap; `setSetting()` resolves to the complete persisted settings. Embedded application surfaces automatically report their document height. Pass `autoResize: false` when an application deliberately manages its host height itself.

## Settings definitions

Applications and their settings are configured in W3Booster. Their client IDs, settings schemas, defaults, and requested scopes are public app metadata. The SDK generates either a TypeScript module containing exact settings types or a plain JavaScript ESM module containing the same immutable runtime metadata. Versioned connection, startup, and settings-resolution behavior stays in `@w3booster/sdk/app` behind the generated `w3boosterApp` binding.

Install the SDK once:

```sh
npm install @w3booster/sdk
```

Bind the project once with the client ID shown in the Application tab:

```sh
npx w3booster-settings init app_your_id
```

This creates `src/w3booster.generated.ts`, stores the public app binding in `package.json`, and adds explicit `w3booster:sync` and `w3booster:check` scripts. This keeps ordinary installs, starts, and builds deterministic and offline-friendly. Pass `--install-hooks` only when a project deliberately wants synchronization after dependency installation and before its existing `dev`, `start`, and `build` scripts. Existing lifecycle commands are preserved and run after synchronization. Installed hooks invoke `w3booster-settings` directly from the lifecycle `PATH`, so they do not assume npm, pnpm, Yarn, or Bun.

Plain-JavaScript applications use the same canonical binding by selecting a JavaScript output:

```sh
npx w3booster-settings init app_your_id --output src/w3booster.generated.js
```

`.js`, `.mjs`, and `.jsx` outputs contain parseable plain ESM with no TypeScript-only syntax. TypeScript remains the default because it also generates exact settings aliases.

Use `--output` when the generated file should live somewhere else or to select the plain-JavaScript format by extension. `--endpoint` is persisted in the project binding for non-default platform environments; connected CI can instead provide `W3BOOSTER_SETTINGS_URL`. Synchronization does not rewrite an unchanged file. During ordinary development, a checked-in binding remains usable when the public endpoint is temporarily unavailable; `npm run w3booster:check` remains deliberately strict for CI.

Use the generated helper in the frontend. The managed runtime completes partial delivered settings over the database defaults and publishes them atomically with state and host capability changes. Generated `W3BoosterAppClient`, `W3BoosterAppRuntime`, and `W3BoosterAppRuntimeSnapshot` aliases preserve the delivered-versus-resolved settings distinction without consumer-side generic reconstruction:

```ts
import { w3boosterApp } from './w3booster.generated';

const runtime = w3boosterApp.createRuntime({ retry: true });
runtime.lifecycle.subscribe(snapshot => {
  renderLayout(snapshot.settings);
  renderMatch(snapshot.state, { fresh: snapshot.isSynchronized });
});

await runtime.start();
await runtime.stop(); // when this application surface is disposed
```

For a pure selector that already receives state, `w3boosterApp.settingsFor(state)` returns the same resolved, memoized settings value. `resolveSettings(partial)` remains available when only a delivered settings object is at hand.

Commit `w3booster.generated.ts` so editors and offline builds retain full types and schema changes remain visible in reviews. Generated runtimes send the binding revision during broker negotiation; an outdated bundle fails once with `APPLICATION_DEFINITION_MISMATCH` instead of running against incompatible defaults or types. Current user values are not part of the public definition; they arrive only through the authenticated `state.application.settings` stream.

The lower-level `validateSettingsSchema()`, `settingsDefaults()`, `resolveSettings()`, and `generateSettingsBinding()` utilities remain available from `@w3booster/sdk/settings` for tooling that needs to inspect definitions directly. Runtime validation alone cannot derive new compile-time field names; use the generated binding when frontend type safety matters.

## Framework integration

Framework-neutral derived state is available without allocating a new result on every unrelated lifecycle update. Subscriber promise rejections are observed. Stores derived from SDK lifecycle/state stores inherit their structured client issue channel automatically; pass `onError` to override reporting for an application-owned source:

```ts
import { createSelectorStore } from '@w3booster/sdk/store';

const connectionStatus = createSelectorStore(runtime.lifecycle, snapshot => snapshot.status);
connectionStatus.subscribe(status => renderStatus(status), { signal: lifetime.signal });
```

For application selectors that allocate arrays or view models, `createMemoizedSelector()` uses a weak cache for each first-argument object identity and retains a bounded set of `Object.is` option variants. Interleaved list and multi-view calls therefore keep their identities. The caller owns invalidation: inputs and returned results must be treated as immutable, and mutation does not invalidate a cached result. This matches recursively frozen SDK snapshots and the identity rules used by reactive frontend stores.

Allocation-heavy public SDK selectors cache recursively frozen SDK inputs, but recompute mutable frontend-owned arrays and records. Deserialized history and other local mutable data therefore cannot receive stale derived results.

React consumers can use the dependency-free adapter with `useSyncExternalStore`. Supplying a deterministic server snapshot keeps SSR and hydration explicit:

```tsx
import { useSyncExternalStore } from 'react';
import { createReactStore } from '@w3booster/sdk/react';

const lifecycleStore = createReactStore(client.lifecycle, {
  getServerSnapshot: () => ({ status: 'idle', state: null, isSynchronized: false, error: null })
});
const lifecycle = useSyncExternalStore(
  lifecycleStore.subscribe,
  lifecycleStore.getSnapshot,
  lifecycleStore.getServerSnapshot
);
```

Angular signals can consume the standard dependency-free subscribable adapter without manual teardown bookkeeping or an SDK dependency on Angular:

```ts
import { toSignal } from '@angular/core/rxjs-interop';
import { createSubscribable } from '@w3booster/sdk/store';

const lifecycle = toSignal(createSubscribable(client.lifecycle), {
  initialValue: client.lifecycle.get()
});
```

The same observer/unsubscribe contract also maps directly to an RxJS observable:

```ts
const lifecycle$ = new Observable(subscriber => {
  const subscription = createSubscribable(client.lifecycle).subscribe(subscriber);
  return () => subscription.unsubscribe();
});
```

## Advanced subpaths

- `@w3booster/sdk/assets` contains versioned URL helpers for shared hosted assets such as country flags.
- `@w3booster/sdk/app` owns typed application bindings created from generated public metadata.
- `@w3booster/sdk/standard-game/objects` contains the optional shipped object table, icon URLs, and ability-cooldown lookup.
- `@w3booster/sdk/standard-game/icons` contains only standard-game icon metadata and URL resolvers.
- `@w3booster/sdk/standard-game/cooldowns` contains only standard-game ability cooldown metadata and derivation.
- `@w3booster/sdk/compositor` contains browser-source composition APIs used by W3Booster's platform compositor. Its watcher renews expired browser-source sessions and reauthorizes reconnects automatically. Returned child launch URLs require HTTPS except for exact loopback development hosts and may not contain URL user information, because their fragments can carry launch credentials. Ordinary applications do not import it.
- `@w3booster/sdk/settings` contains settings-schema types, validation, default derivation, and database-definition code generation.
- `@w3booster/sdk/testing` contains `createDemoTransport` and custom transport types for SDK and integration tests. Application demo mode normally uses `startClient({ demo: true })` instead.
- `@w3booster/sdk/react` adapts immediately-publishing SDK stores to React's complete `useSyncExternalStore` contract without adding React as a package dependency.
- `@w3booster/sdk/store` creates stable framework-neutral derived stores with configurable equality and signal-owned subscriptions.

Custom transports are intentionally isolated to the testing namespace:

```ts
import { openClient } from '@w3booster/sdk';
import { createDemoTransport, type TestingConnectOptions } from '@w3booster/sdk/testing';

const options: TestingConnectOptions = {
  clientId: 'your_app_id',
  transport: createDemoTransport()
};

const client = await openClient(options);
```

The complete public data model is exported from `@w3booster/sdk`. See `COMPATIBILITY.md` for the Semantic Versioning and protocol policy and `CHANGELOG.md` for release changes.
