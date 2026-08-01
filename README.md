# @w3booster/sdk

One small browser SDK for W3Booster overlays and web applications. Developers subscribe to hydrated match state; the SDK chooses the available W3Booster transport.

```js
import { connect } from '@w3booster/sdk';

const w3 = await connect('your_app_id');
const initialState = await w3.whenReady();

w3.state.subscribe(state => {
  console.log(state.match, state.players);
});

w3.on('hero.inventory.changed', ({ player, inventory }) => {
  console.log(player.name, inventory);
});
```

That is the complete production setup. W3Booster takes the scopes from the application record, selects the transport, supplies the launch credential, reconnects, validates messages, applies patches, and keeps immutable state. Pass a `scopes` array only when an app intentionally wants a smaller subset than it declared.

Use `demo: true` while developing without a running W3Booster platform. To test real data, start your localhost server and choose **Test locally** on your private app in W3Booster. Add the localhost URLs and start the 12-hour dev session. W3Booster opens the same application, stream-overlay, and in-game-overlay surfaces with real app credentials; your published URLs and every other user remain unchanged.

The SDK connects to W3Booster Cloud by default. Platform developers can explicitly select localhost so a broken local backend never silently falls back:

```js
const w3 = await connect({
  clientId: 'your_app_id',
  backend: 'local'
});
```

Use `localApi: 'https://localhost:25080'` to change the local address, `backend: 'auto'` to try local and then cloud, or pass a complete URL as `backend` for another platform environment.
When W3Booster launches an application, the SDK automatically honors the platform-provided `backend=local` or `backend=cloud` URL parameter. Application code must not parse or forward this parameter itself.
Remote API and WebSocket endpoints must use HTTPS/WSS. Plain HTTP/WS is accepted only for localhost development, preventing launch credentials from being sent over an unencrypted network.

There is no login screen inside the app. The SDK consumes the launch credential, keeps it for page reloads, exchanges it for one-use stream tickets, and reconnects automatically. Applications never receive the browser-source channel or secret and never select a transport.

Install with `npm install @w3booster/sdk`. Releases are automated: update the package version and changelog, merge that commit to `main`, then push the matching version tag (for example, `v0.2.0`). GitHub Actions verifies the tag, runs the complete prepublish checks, and publishes the public npm package with provenance.

The SDK keeps the complete immutable state while compact updates arrive. Use `subscribe` when a view depends on the whole match, `watch` for a selected value, or domain events for actions:

```js
const stopClock = w3.state.watch(
  state => state.match.gameTime,
  seconds => drawClock(seconds)
);

w3.on('match.started', ({ match }) => showMatch(match));
w3.on('player.resources.changed', ({ player, resources }) => updateEconomy(player.id, resources));
w3.on('hero.changed', ({ player, hero }) => updateHero(player.id, hero));
```

Useful events include `state.ready`, `state.changed`, `match.started`, `match.changed`, `match.ended`, `player.changed`, `player.resources.changed`, `player.stats.changed`, `player.upgrades.changed`, `hero.changed`, `hero.inventory.changed`, and `hero.abilities.changed`. Every `on`, `watch`, and `subscribe` call returns an unsubscribe function.

Settings defined in your application metadata are available as `state.application.settings`. When a user saves settings, the SDK reconnects and emits `application.settings.changed`.

Type your settings and the entire event/store API follows that type:

```ts
interface Settings {
  layout: 'compact' | 'wide';
  showHeroes: boolean;
}

const w3 = await connect<Settings>('your_app_id');
w3.state.subscribe(state => setLayout(state.application?.settings.layout));
```

The package exports the complete public data model, including `MatchState`, `Match`, `Player`, `Hero`, `Resources`, statistics, upgrades, capabilities, protocol envelopes, patches, surfaces, scopes, and all event payloads. State is validated at runtime and unknown additive fields are preserved for forward compatibility.

## State selectors

Import pure, framework-free conveniences from `@w3booster/sdk/selectors`. Selectors derive common values from live state without changing it:

```js
import { broadcasterPlayer, groupPlayersByTeam, heroInventory } from '@w3booster/sdk/selectors';

const broadcaster = broadcasterPlayer(state.match, state.players);
const teams = groupPlayersByTeam(state.players);
const items = heroInventory(broadcaster?.heroes?.[0]);
```

The selector namespace also provides `isActiveMatch()`, `battleTagName()`, and `playerRelationship()`. Grouping retains each protocol `teamId`; ordering teams or assigning relationship colors remains an application presentation decision. `broadcasterPlayer()` returns `null` if the configured identity is absent. Pass `{ fallbackToFirst: true }` only when that fallback is intentional.

## Warcraft III standard-game data

Live state and static game knowledge are separate. Import the optional standard-game namespace when an app needs Warcraft III's shipped object metadata or ruleset helpers:

```js
import * as standardGame from '@w3booster/sdk/standard-game';

const hero = standardGame.getObject('Hamg');
console.log(hero?.icon);                         // btnheroarchmage.png
console.log(standardGame.iconUrl('Hamg'));       // hosted Reforged icon URL
console.log(standardGame.getAbilityCooldown('AHbz', 1)); // 6
console.log(standardGame.raceName('night-elf'));         // Night Elf
console.log(standardGame.isMode('gm-1v1', '1v1'));       // true

const cooldown = standardGame.abilityCooldown(heroAbility, state.match.gameTime);
const stats = standardGame.statsForMode(player, state.match.mode);
const clock = standardGame.dayNightState(state.match.gameTime);
const heroProgress = standardGame.heroExperienceState(hero.experience);
const showUpgrade = standardGame.isWeaponOrArmorUpgrade(upgrade.name);
```

The namespace provides immutable rawcode metadata, hosted icon URLs, numeric field lookup, ability cooldown state, weapon/armor-upgrade classification, race labels, Warcraft player colors, mode-specific statistics, the standard day/night clock, and hero experience progression. It owns Warcraft semantics such as activation timestamp units so applications do not need to reproduce them. It does not own application presentation rules such as sprite frames, team palettes, or team ordering. It is a subpath so apps that only need realtime state do not bundle the object table.

Icons default to the immutable `https://assets.w3booster.com/wc3/standard-game/v1/` catalog. Select Classic graphics or replace the base for local/offline hosting:

```js
const icon = standardGame.iconUrl('Hamg', {
  graphics: state.match.isReforged ? 'reforged' : 'classic',
  baseUrl: 'http://localhost:8080'
});
```

`assetManifestUrl()` returns the catalog manifest. The npm package contains metadata and URL helpers, not Blizzard artwork.

Here, **standard game** means the objects and constants shipped by Blizzard, including standard melee and campaign objects. A custom map can replace or add object data, gameplay constants, triggers, and assets; the SDK does not claim that standard-game metadata describes those changes. Live recorder values remain authoritative whenever they are available.

Application surfaces can ask W3Booster to open an app-owned subwindow. This is useful for compact controls or secondary tools:

```js
w3.host.openWindow({ path: '?view=compact', width: 520, height: 620 });
```

For supported platform actions, use `w3.host.command(name, payload)`. Both methods return `false` when the app is running outside the W3Booster host.

Use `w3.host.setSetting(path, value)` for the common settings case. Existing `w3.match`, `MatchStore`, `getState()`, and `getPlayer()` APIs remain as compatibility aliases. See `COMPATIBILITY.md` for the Semantic Versioning and protocol-support policy.

Run tests with `npm test`.
