import type {
  MatchState,
  OverlayRuntimeState,
  Player,
  ProtocolEnvelope,
  Scope,
  StateStore,
  W3BoosterIssue
} from '../src/index.js';
import { canUseHostCapability, classifyW3BoosterError, connect, ConnectionError, PermissionRequiredError, ProtocolError, W3BoosterClient } from '../src/index.js';
import { defineApplication } from '../src/app.js';
import { broadcasterFirstTeams, broadcasterPlayer, currentUpgrades, groupPlayersByTeam, hasCapability, heroInventory, inventorySlotIdentity, matchScore, overlayRuntime as selectOverlayRuntime, playerHeroes, playerResources, upgradeIdentity } from '../src/selectors.js';
import type { PlayerTeam } from '../src/selectors.js';
import * as standardGame from '../src/standard-game.js';
import * as standardGameObjects from '../src/standard-game-objects.js';
import * as standardGameIcons from '../src/standard-game-icons.js';
import * as standardGameCooldowns from '../src/standard-game-cooldowns.js';
import { countryFlagUrl } from '../src/assets.js';
import { getOverlayComposition } from '../src/compositor.js';
import { createDemoState, createDemoTransport } from '../src/testing.js';
import type { TestingConnectOptions, Transport } from '../src/testing.js';
import { resolveSettings, settingsDefaults, validateSettingsSchema } from '../src/settings.js';
import type { AppSettingsSchema, DeepPartial } from '../src/settings.js';
import { createReactStore } from '../src/react.js';

interface ExampleSettings {
  layout: 'compact' | 'wide';
  showHeroes?: boolean;
  labels?: Record<string, string>;
}

async function useSdk() {
  // @ts-expect-error Public clients must go through connect/createClient so setup stays normalized.
  new W3BoosterClient<ExampleSettings>('app_example');
  const abortController = new AbortController();
  const client: W3BoosterClient<ExampleSettings> = await connect<ExampleSettings>('app_example');
  const recorderClient = await connect<ExampleSettings>({ clientId: 'app_example', localRecorder: true, signal: abortController.signal, retry: true });
  await recorderClient.start({ until: 'synchronized', signal: abortController.signal });
  const state: MatchState<ExampleSettings> = await client.whenReady({ signal: abortController.signal });
  const synchronizedState: MatchState<ExampleSettings> = await client.whenSynchronized({ signal: abortController.signal });
  const layout: 'compact' | 'wide' | undefined = state.application?.settings.layout;
  const player: Player | null = client.state.player('0');
  const store: StateStore<ExampleSettings> = client.state;
  const scopes: Scope[] = ['match:read', 'players:read'];
  const overlayRuntime: OverlayRuntimeState | undefined = state.overlay?.runtime;
  const archmageIcon: string | undefined = standardGameObjects.getIcon('Hamg');
  const archmageIconUrl: string | undefined = standardGameObjects.iconUrl('Hamg', { graphics: 'reforged' });
  const specializedIconUrl: string | undefined = standardGameIcons.iconUrl('Hamg', { graphics: 'reforged' });
  const specializedCooldown: number | undefined = standardGameCooldowns.getAbilityCooldown('AHbz', 1);
  const germanFlagUrl: string | undefined = countryFlagUrl('DE');
  const heroLevel: number = standardGame.heroExperienceState(500).level;
  const heroHealth: number = standardGame.valuePoolRatio({ current: 50, max: 100 });
  const orderedPlayers: Player[] = standardGame.orderHeadToHeadPlayers(state.players);
  const presentationTeams: PlayerTeam[] = standardGame.orderMatchTeams(state.players, state.match);
  const classified = classifyW3BoosterError(new ConnectionError('offline'));
  const lifecycleStore = createReactStore(client.lifecycle);
  const broadcaster: Player | null = broadcasterPlayer(state.match, state.players);
  const teams: PlayerTeam[] = groupPlayersByTeam(state.players);
  const orderedTeams: PlayerTeam[] = broadcasterFirstTeams(state.players, state.match);
  const inventory: readonly string[] = heroInventory(state.players[0]?.heroes?.[0]);
  const stableRuntime: OverlayRuntimeState = selectOverlayRuntime(state);
  const score: Readonly<{ wins: number; losses: number }> = matchScore(state);
  const resources = playerResources(state.players[0]);
  const heroes = playerHeroes(state.players[0]);
  const inventoryKey: string = inventorySlotIdentity(0, inventory[0]);
  const cooldown = state.players[0]?.heroes?.[0]?.abilities?.[0]
    ? standardGameObjects.abilityCooldown(state.players[0].heroes[0].abilities[0], state.match.gameTime)
    : undefined;
  const cooldowns = standardGameObjects.abilityCooldownsForState(state);
  const heroIcon = standardGameObjects.heroIconUrl(state.players[0]?.heroes?.[0]);
  const current = currentUpgrades(state.players[0]);
  const upgradeKey: string | undefined = current[0] ? upgradeIdentity(current[0]) : undefined;
  const presentationColor: string = standardGame.presentationPlayerColor(state.players[0], state.match, state.players, stableRuntime);
  const displayLevel: string | undefined = state.players[0]?.heroes?.[0]
    ? standardGame.formatHeroLevelProgress(state.players[0].heroes[0])
    : undefined;
  const resourcesAvailable: boolean = hasCapability(state, 'resources');
  const fixture: MatchState<ExampleSettings> = createDemoState({ clientId: 'app_example', settings: { layout: 'wide' } });
  const message: ProtocolEnvelope<'state.snapshot', MatchState<ExampleSettings>> = {
    version: '1.0',
    sequence: 1,
    type: 'state.snapshot',
    data: state
  };

  client.state.watch(current => current?.match.gameTime ?? null, async seconds => console.log(seconds), { signal: abortController.signal });
  client.state.watch(current => ({ id: current?.match.id ?? null }), value => console.log(value), { equals: (left, right) => left.id === right.id });
  client.subscribeStatus(status => console.log(status), { signal: abortController.signal });
  client.lifecycle.subscribe(snapshot => console.log(snapshot.status, snapshot.isSynchronized, snapshot.state, snapshot.error));
  client.on('hero.changed', async event => {
    console.log(event.player.id, event.hero.level, event.changedFields);
    // @ts-expect-error Event payloads are immutable for every listener.
    event.changedFields = [];
  }, { signal: abortController.signal });
  client.on('application.settings.changed', event => console.log(event.settings?.layout));
  client.on('issue', (issue: W3BoosterIssue) => console.log(issue.source, issue.recoverable, issue.error));
  // @ts-expect-error Known-event subscriptions reject misspelled names.
  client.on('player.resource.changed', () => undefined);
  client.onUnknown('custom.extension.event', data => console.log(data));
  client.host.setSetting('layout', 'wide');
  const savedSettings: Readonly<ExampleSettings> = await client.host.setSetting('labels.player', 'Player');
  await client.host.changeMatchScore('wins', 1);
  await client.host.openWindow({ path: '?view=compact' });
  const hostCapabilities = await client.host.refreshCapabilities();
  const canOpenWindow: boolean = client.host.can('window:open');
  const hostCapabilityStatus: 'unavailable' | 'pending' | 'known' | 'legacy' = client.host.capabilityStatus;
  const reactiveCanOpenWindow: boolean = canUseHostCapability(client.host.lifecycle.get(), 'window:open');
  client.host.lifecycle.subscribe(snapshot => console.log(snapshot.available, snapshot.capabilityStatus, snapshot.capabilities));
  // @ts-expect-error Setting values are checked against the application settings type.
  client.host.setSetting('layout', 'invalid');
  // @ts-expect-error Unknown setting paths are rejected.
  client.host.setSetting('missing', true);
  // @ts-expect-error Indexed setting values retain their declared value type.
  client.host.setSetting('labels.player', false);
  const demoTransport: Transport = createDemoTransport<ExampleSettings>();
  const synchronousTransport: Transport = { name: 'synchronous', open() {} };
  const testingOptions: TestingConnectOptions<ExampleSettings> = { clientId: 'app_example', transport: demoTransport };
  const testingClient = await connect(testingOptions);
  const readonlyScopes = ['match:read', 'players:read'] as const;
  const scopedClient = await connect({ clientId: 'app_example', scopes: readonlyScopes });
  const configuredDemo = await connect<ExampleSettings>({
    clientId: 'app_example',
    demo: { settings: { layout: 'compact' }, surface: 'streamOverlay' }
  });
  const application = defineApplication<ExampleSettings, readonly ['match:read']>({
    clientId: 'app_example',
    revision: 'revision',
    scopes: ['match:read'],
    settingsDefaults: { layout: 'compact' }
  });
  const applicationRuntime = application.createRuntime({ demo: { interval: 0 } });
  applicationRuntime.lifecycle.subscribe(snapshot => {
    const resolvedLayout: 'compact' | 'wide' = snapshot.settings.layout;
    const runtimeState: MatchState<DeepPartial<ExampleSettings>> | null = snapshot.state;
    console.log(resolvedLayout, runtimeState, canUseHostCapability(snapshot.host, 'window:open'));
  });
  await applicationRuntime.start();
  await applicationRuntime.stop();
  const settingsSchema: AppSettingsSchema<ExampleSettings> = {
      version: 1,
      sections: [{
        id: 'display',
        title: 'Display',
        groups: [{ id: 'layout', title: 'Layout' }],
        fields: [{
          key: 'layout',
          label: 'Layout',
          type: 'select',
          default: 'compact',
          options: [{ value: 'compact', label: 'Compact' }, { value: 'wide', label: 'Wide' }],
          group: 'layout'
        }]
      }]
  };
  const validatedSchema = validateSettingsSchema(settingsSchema);
  const defaults: Readonly<DeepPartial<ExampleSettings>> = settingsDefaults<ExampleSettings>(validatedSchema);
  const resolvedSettings: Readonly<DeepPartial<ExampleSettings>> = resolveSettings<ExampleSettings>(defaults, { layout: 'wide' });
  // @ts-expect-error Hydrated state is immutable at runtime and in the public declaration.
  state.match.gameTime = 10;
  // @ts-expect-error Client status is observational and managed by the SDK.
  client.status = 'closed';
  // @ts-expect-error Additive runtime fields do not hide misspelled public properties.
  state.match.gameTIme;
  // @ts-expect-error Overlay runtime fields retain spelling safety.
  state.overlay?.runtime.hudScael;
  const composition = await getOverlayComposition({ surface: 'streamOverlay' });
  const permissionError = new PermissionRequiredError('permission', 'https://w3booster.com/authorize');
  const connectionError = new ConnectionError('connection', [permissionError]);
  const protocolError = new ProtocolError('INVALID_TEST', 'protocol', { field: 'value' });
  const development: boolean | undefined = composition[0]?.development;
  console.log(layout, player, store, scopes, message, synchronizedState, state ? store.isSynchronized : false, overlayRuntime?.hudScale, archmageIcon, archmageIconUrl, specializedIconUrl, specializedCooldown, heroIcon, germanFlagUrl, heroLevel, broadcaster, teams, orderedTeams, presentationTeams, inventory, stableRuntime, inventoryKey, current, upgradeKey, presentationColor, displayLevel, resourcesAvailable, fixture, cooldown, cooldowns, resolvedSettings, recorderClient.diagnostics.localTransport, testingOptions, testingClient, synchronousTransport, scopedClient, configuredDemo, composition, development, connectionError, protocolError, hostCapabilities, canOpenWindow, hostCapabilityStatus);
}

void useSdk;
