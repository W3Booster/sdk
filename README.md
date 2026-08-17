# @w3booster/sdk

Browser SDK for realtime W3Booster match data in applications and overlays. It handles app authorization, transport selection, reconnects, protocol validation, patches, and immutable hydrated state.

## Quick start

```sh
npm install @w3booster/sdk
```

```js
import { connect } from '@w3booster/sdk';

const client = await connect('your_app_id');

const unsubscribe = client.state.subscribe(state => {
  render(state.match, state.players);
});
```

The client ID is the public, immutable identifier generated when an app is created in W3Booster. It is not a secret. Scopes come from the application record by default, so normal applications do not pass connection URLs, credentials, or scopes.

Use `demo: true` when W3Booster is not running:

```js
const client = await connect({ clientId: 'your_app_id', demo: true });
```

For real data during development, run the app on localhost and use **Apps → Developer → My apps → Test locally**. The temporary session supplies real credentials and replaces only your app surfaces. Application code remains unchanged.

W3Booster Cloud is the default backend. A platform-provided `?backend=local` or `?backend=cloud` launch parameter is handled by the SDK automatically; application code must not parse or forward it. Platform developers can force the local API explicitly:

```js
const client = await connect({
  clientId: 'your_app_id',
  backend: 'local'
});
```

`backend: 'auto'` tries local and then cloud. A complete HTTPS URL selects another platform environment. Remote HTTP and WebSocket endpoints must use HTTPS/WSS; unencrypted HTTP/WS is accepted only for localhost.

## State lifecycle

`connect()` resolves when a transport is connected. Use `whenReady()` when work must wait for the first hydrated snapshot:

```js
const initialState = await client.whenReady(); // 10-second default timeout
```

`client.state` is the authoritative source of current data:

- `get()` returns the current state or `null` before the first snapshot.
- `player(id)` returns one current player or `null`.
- `subscribe(listener)` runs immediately when state already exists and after every update.
- `watch(selector, listener)` runs for the first selected value and then when its structural value changes.
- Every subscription method returns an unsubscribe function.

The initial snapshot emits `state.ready` and `state.changed`. Match, player, and hero domain events describe changes after that snapshot; they are not a replacement for rendering initial state. In particular, an already-running match does not synthesize `match.started` when the app opens.

```js
const stopClock = client.state.watch(
  state => state.match.gameTime,
  (seconds, previousSeconds) => drawClock(seconds, previousSeconds)
);

client.on('match.started', ({ match }) => showNewMatch(match));
client.on('player.resources.changed', ({ player, resources }) => updateEconomy(player.id, resources));
client.on('hero.changed', ({ player, hero }) => updateHero(player.id, hero));
```

`client.status` is the current connection state. The `status` event reports later transitions such as `reconnecting`, `connected`, and `error`. Automatic network reconnects preserve hydrated state. An explicit `disconnect()` closes transports and clears state and diagnostics; existing subscriptions remain registered if the same client is connected again.

Concurrent `connect()` calls share one connection attempt. To cancel an initial connection while a view is being destroyed, pass an `AbortSignal`; cancellation rejects with the standard `AbortError` name:

```js
const controller = new AbortController();
const connection = connect({ clientId: 'your_app_id', signal: controller.signal });
controller.abort();
```

## Scopes and capabilities

An application requests scopes in its W3Booster metadata. The server filters every snapshot to the granted scopes. Passing `scopes` to `connect()` can only request a smaller subset.

| Scope | Capability | Conditional state |
| --- | --- | --- |
| `match:read` | `match` | Match lifecycle, time, map, mode, realm, and broadcaster IDs |
| `players:read` | `players` | Player identity, race, team, color, and position |
| `stats:read` | `stats` | Ranking statistics and main-account data |
| `heroes:read` | `heroes` | Heroes, health, mana, abilities, and inventory |
| `upgrades:read` | `upgrades` | Completed, active, and researching upgrades |
| `resources:read` | `resources` | Gold, lumber, supply, and worker supply |
| `controlgroups:read` | `controlgroups` | Control-group front units and sizes |
| `overlay:read` | `overlay` | Overlay settings and recorder runtime values |

A granted scope does not guarantee that data exists in every match or account context. Check `state.capabilities` and keep conditional fields optional:

```js
client.state.subscribe(state => {
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
- `status`, `error`, and `stream.gap`

`on()` and `once()` return unsubscribe functions. Listener failures are isolated and forwarded to the `error` event so one application callback cannot interrupt state delivery.

## Typed application settings

Settings defined in application metadata are delivered as `state.application.settings`. Type the settings once and the state, events, and store inherit that type:

```ts
interface Settings {
  layout: 'compact' | 'wide';
  showHeroes?: boolean;
}

const client = await connect<Settings>('your_app_id');

client.state.subscribe(state => {
  const settings = state.application?.settings;
  if (settings) setLayout(settings.layout);
});
```

`client.host.setSetting(path, value)` returns `true` when a command was delivered to the W3Booster host, not when persistence has completed. Treat the later `application.settings.changed` event as confirmation of the current saved value.

## Errors and troubleshooting

Handle initial connection failures around `connect()` and later stream or listener failures with the `error` event:

```js
import {
  connect,
  ConnectionError,
  PermissionRequiredError,
  ProtocolError
} from '@w3booster/sdk';

try {
  const client = await connect('your_app_id');
  client.on('error', error => {
    if (error instanceof ProtocolError) console.error(error.code, error.details);
    else console.error(error);
  });
} catch (error) {
  if (error instanceof PermissionRequiredError) {
    showMessage('Enable and open this app from W3Booster.');
  } else if (error instanceof ConnectionError) {
    console.error(error.message, error.causes);
  } else {
    throw error;
  }
}
```

Common causes:

- **Permission required:** the URL was opened directly, the app is disabled, or its temporary development session expired.
- **No initial state:** `whenReady()` timed out before the platform supplied a snapshot.
- **Local connection failure:** trust the W3Booster localhost certificate and verify the local backend is running.
- **Protocol error:** inspect `ProtocolError.code`; the SDK requests a resync automatically after invalid state or a sequence gap.
- **Missing fields:** verify the application scope, the matching capability, and whether that data exists for the current match.

The package targets modern ESM browsers with `fetch`, `WebSocket`, and `AbortController`. Node.js is supported for tooling and tests; realtime Node usage must provide an appropriate WebSocket environment or a testing transport.

## Low-latency recorder data

During active observer and replay matches, the SDK automatically consumes the local recorder socket advertised by authenticated platform state. The platform remains authoritative for identity, permissions, settings, capabilities, and the initial snapshot; the local socket overlays volatile match values such as game time, HUD scale, resources, heroes, and upgrades. If that socket disconnects, cached recorder values stop overriding authenticated platform snapshots until the recorder reconnects and sends fresh data.

Only loopback and private-network socket addresses are accepted. Capabilities still control all exposed fields. Set `localRecorder: false` only when an application deliberately needs to disable this behavior. `client.diagnostics.localTransport` is `recorder-local` while it is active.

## Selectors

Pure state helpers live in `@w3booster/sdk/selectors`:

```js
import {
  broadcasterPlayer,
  groupPlayersByTeam,
  heroInventory,
  playerRelationship
} from '@w3booster/sdk/selectors';

const broadcaster = broadcasterPlayer(state.match, state.players);
const teams = groupPlayersByTeam(state.players);
const relation = playerRelationship(state.players[0], state.match, state.players);
const inventory = heroInventory(broadcaster?.heroes?.[0]);
```

Also available: `isActiveMatch()` and `battleTagName()`. Selectors preserve protocol meaning without imposing presentation rules such as team ordering or colors.

## Warcraft III standard-game data

Optional static Warcraft III knowledge lives in `@w3booster/sdk/standard-game` so applications that only need live state do not bundle the object table:

```js
import * as standardGame from '@w3booster/sdk/standard-game';

const hero = standardGame.getObject('Hamg');
const icon = standardGame.iconUrl('Hamg', { graphics: 'reforged' });
const cooldown = standardGame.abilityCooldown(ability, state.match.gameTime);
const progress = standardGame.heroExperienceState(heroState.experience);
const clock = standardGame.dayNightState(state.match.gameTime);
```

The namespace includes immutable shipped-object metadata, Classic/Reforged icon URLs, cooldowns, upgrade classification, race labels, player colors, melee modes, statistics selection, the day/night clock, and hero progression. Custom maps can replace these objects and rules; live recorder values remain authoritative.

Icons default to the immutable `https://assets.w3booster.com/wc3/standard-game/v1/` catalog. Pass `baseUrl` for a local asset mirror. The npm package contains metadata and URL helpers, not Blizzard artwork.

## Host actions

Embedded surfaces can ask W3Booster to perform supported host actions:

```js
client.host.openWindow({ path: '?view=compact', width: 520, height: 620 });
client.host.command('my.command', { value: 1 });
```

Host methods return `false` outside the W3Booster host.

## Advanced subpaths

- `@w3booster/sdk/compositor` contains browser-source composition APIs used by W3Booster's platform compositor. Its watcher renews expired browser-source sessions and reauthorizes reconnects automatically. Ordinary applications do not import it.
- `@w3booster/sdk/testing` contains `createDemoTransport` and custom transport types for SDK and integration tests. Application demo mode normally uses `connect({ demo: true })` instead.

The complete public data model is exported from `@w3booster/sdk`. See `COMPATIBILITY.md` for the Semantic Versioning and protocol policy and `CHANGELOG.md` for release changes.
