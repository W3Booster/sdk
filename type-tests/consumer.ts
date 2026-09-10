import type {
  MatchState,
  GameContext,
  Player,
  ProtocolEnvelope,
  Scope,
  StateStore,
  W3BoosterIssue
} from '../src/index.js';
import { canUseHostCapability, classifyW3BoosterError, openClient, ConnectionError, createClient, PermissionRequiredError, ProtocolError, startClient, W3BoosterClient } from '../src/index.js';
import { defineApplication } from '../src/app.js';
import type { ApplicationRuntimeStartOptions } from '../src/app.js';
import { broadcasterFirstTeams, broadcasterPlayer, currentUpgrades, groupPlayersByTeam, hasCapability, headToHeadPair, heroInventory, inventorySlotIdentity, gameContext as selectGameContext, playerDisplayIdentity, playerHeroes, playerResources, playerResourcesOrZero, upgradeIdentity } from '../src/selectors.js';
import type { PlayerTeam } from '../src/selectors.js';
import * as standardGame from '../src/standard-game.js';
import * as standardGameIcons from '../src/standard-game-icons.js';
import * as standardGameCooldowns from '../src/standard-game-cooldowns.js';
import { countryFlagUrl } from '../src/assets.js';
import { getOverlayComposition } from '../src/compositor.js';
import { createDemoState, createDemoTransport } from '../src/testing.js';
import type { TestingConnectOptions, Transport } from '../src/testing.js';
import { resolveSettings, settingsDefaults, validateSettingsSchema } from '../src/settings.js';
import type { AppSettingsSchema, DeepPartial } from '../src/settings.js';
import { createReactStore } from '../src/react.js';
import { createMemoizedSelector, createSelectorStore, createSubscribable } from '../src/store.js';
import type { Subscribable } from '../src/store.js';

interface ExampleSettings {
  layout: 'compact' | 'wide';
  showHeroes?: boolean;
  labels?: Record<string, string>;
}
interface ExampleOverlayExtensions {
  readonly tournament: { readonly round: number };
}
interface HistoryPlayer { readonly team?: number | null; readonly name: string }
interface OrderedHistoryPlayer extends HistoryPlayer {
  readonly id: string;
  readonly startPosition?: Player['startPosition'];
}

async function useSdk() {
  // @ts-expect-error Public clients must go through openClient/createClient so setup stays normalized.
  new W3BoosterClient<ExampleSettings>('app_example');
  const abortController = new AbortController();
  const client: W3BoosterClient<ExampleSettings> = await openClient<ExampleSettings>('app_example');
  const recorderClient = await openClient<ExampleSettings>({ clientId: 'app_example', localRecorder: true, signal: abortController.signal, retry: true });
  await recorderClient.start({ until: 'synchronized', signal: abortController.signal });
  const state: MatchState<ExampleSettings> = await client.whenReady({ signal: abortController.signal });
  const synchronizedState: MatchState<ExampleSettings> = await client.whenSynchronized({ signal: abortController.signal });
  const layout: 'compact' | 'wide' | undefined = state.application?.settings.layout;
  const player: Player | null = client.state.player('0');
  const store: StateStore<ExampleSettings> = client.state;
  const scopes: Scope[] = ['match:read', 'players:read'];
  const context: GameContext = state.gameContext;
  const archmageIcon: string | undefined = standardGameIcons.getIcon('Hamg');
  const archmageIconUrl: string | undefined = standardGameIcons.iconUrl('Hamg', { graphics: 'reforged' });
  const specializedIconUrl: string | undefined = standardGameIcons.iconUrl('Hamg', { graphics: 'reforged' });
  const specializedCooldown: number | undefined = standardGameCooldowns.getAbilityCooldown('AHbz', 1);
  const germanFlagUrl: string | undefined = countryFlagUrl('DE');
  const heroLevel: number = standardGame.heroExperienceState(500).level;
  const heroHealth: number = standardGame.valuePoolRatio({ current: 50, max: 100 });
  const raceLocalizationKey: `race.${import('../src/index.js').Race}` = standardGame.raceInfo('night_elf').localizationKey;
  const orderedPlayers: readonly Player[] = standardGame.orderHeadToHeadPlayers(state.players);
  const scopedPair: readonly [Player, Player] | null = headToHeadPair(state.players);
  const orderedPair: readonly [Player, Player] = standardGame.orderHeadToHeadPlayers(
    [state.players[0], state.players[1]] as const
  );
  const presentationTeams: readonly PlayerTeam[] = standardGame.orderMatchTeams(state.players, state.match);
  const classified = classifyW3BoosterError(new ConnectionError('offline'));
  if (classified.kind === 'connection') {
    const classifiedCode: 'UNAVAILABLE' | 'CONFIGURATION' | 'APPLICATION_DEFINITION_MISMATCH' | 'MISSING_BROWSER_API' | 'BROKER_TIMEOUT' | 'STARTUP_TIMEOUT' | 'STATE_TIMEOUT' | 'HOST_UNAVAILABLE' | 'HOST_TIMEOUT' = classified.code;
    const classifiedStatus: number | undefined = classified.error.status;
    console.log(classifiedCode, classifiedStatus);
  } else if (classified.kind === 'permission') {
    const authorizeUrl: string | undefined = classified.error.authorizeUrl;
    console.log(authorizeUrl);
  }
  const lifecycleStore = createReactStore(client.lifecycle);
  const statusStore = createSelectorStore(client.lifecycle, snapshot => snapshot.status);
  const statusSubscribable: Subscribable<string> = createSubscribable(statusStore);
  const broadcaster: Player | null = broadcasterPlayer(state.match, state.players);
  const teams: readonly PlayerTeam[] = groupPlayersByTeam(state.players);
  const orderedTeams: readonly PlayerTeam[] = broadcasterFirstTeams(state.players, state.match);
  const inventory: readonly string[] = heroInventory(playerHeroes(state.players[0])[0]);
  const stableRuntime: GameContext = selectGameContext(state);
  const resources: Readonly<import('../src/index.js').Resources> | undefined = playerResources(state.players[0]);
  const resourcesOrZero: Readonly<import('../src/index.js').Resources> = playerResourcesOrZero(state.players[0]);
  const heroes = playerHeroes(state.players[0]);
  const allHeroes = playerHeroes(state.players[0], { includeIllusions: true });
  const illusion: boolean | undefined = allHeroes[0]?.isIllusion;
  const inventoryKey: string = inventorySlotIdentity(0, inventory[0]);
  const firstAbility = heroes[0]?.abilities?.[0];
  const cooldown = firstAbility
    ? standardGameCooldowns.abilityCooldown(firstAbility, state.match.gameTime)
    : undefined;
  const cooldowns = standardGameCooldowns.abilityCooldownsForState(state);
  const heroIcon = standardGameIcons.heroIconUrl(playerHeroes(state.players[0])[0]);
  const current = currentUpgrades(state.players[0]);
  const upgradeKey: string | undefined = current[0] ? upgradeIdentity(current[0]) : undefined;
  const presentationColor: string = standardGame.presentationPlayerColor(state.players[0], state.match, state.players, stableRuntime);
  const displayLevel: string | undefined = playerHeroes(state.players[0])[0]
    ? standardGame.formatHeroLevelProgress(playerHeroes(state.players[0])[0])
    : undefined;
  const resourcesAvailable: boolean = hasCapability(state, 'resources');
  const fixture: MatchState<ExampleSettings> = createDemoState({ clientId: 'app_example', settings: { layout: 'wide' } });
  const extensionFixture: MatchState<ExampleSettings, ExampleOverlayExtensions> = createDemoState({
    clientId: 'app_example',
    settings: { layout: 'wide' },
    overlayExtensions: { tournament: { round: 1 } }
  });
  const message: ProtocolEnvelope<'state.snapshot', MatchState<ExampleSettings>> = {
    version: '1.0',
    sequence: 1,
    type: 'state.snapshot',
    data: state
  };

  client.state.watch(current => current?.match.gameTime ?? null, async seconds => console.log(seconds), { signal: abortController.signal });
  client.state.watch(current => ({ id: current?.match.id ?? null }), value => console.log(value), { equals: (left, right) => left.id === right.id });
  client.subscribeStatus(status => console.log(status), { signal: abortController.signal });
  client.subscribeMatchLifecycle(event => console.log(event.phase, event.initial, event.observedAt), { signal: abortController.signal });
  client.subscribeMatchLifecycle(event => console.log(event.match.id), { includeCurrentFinished: true });
  client.lifecycle.subscribe(snapshot => console.log(
    snapshot.status, snapshot.isSynchronized, snapshot.state, snapshot.error,
    snapshot.retry?.attempt, snapshot.retry?.maxAttempts, snapshot.retry?.nextDelay, snapshot.retry?.lastError
  ));
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
  client.once('*', event => console.log(event.type));
  client.host.setSetting('layout', 'wide');
  const savedSettings: Readonly<ExampleSettings> = await client.host.setSetting('labels.player', 'Player');
  const hostActionLifetime = new AbortController();
  const windowResult: void = await client.host.openWindow({ path: '?view=compact' }, { timeout: 1000 });
  const commandResult: { accepted: boolean } = await client.host.command('example.command', { enabled: true }, {
    parse(value): { accepted: boolean } {
      if (typeof value !== 'object' || value === null || !('accepted' in value) || typeof value.accepted !== 'boolean') {
        throw new TypeError('invalid command acknowledgement');
      }
      return { accepted: value.accepted };
    }
  });
  const unknownCommandResult: unknown = await client.host.command('example.command');
  void unknownCommandResult;
  // @ts-expect-error Typed host results require a runtime parser.
  const legacyTypedCommandResult: { accepted: boolean } = await client.host.command<{ accepted: boolean }>(
    'example.command', { enabled: true }
  );
  void legacyTypedCommandResult;
  const hostCapabilities = await client.host.refreshCapabilities({ signal: hostActionLifetime.signal });
  const canOpenWindow: boolean = client.host.can('window:open');
  const hostCapabilityStatus: 'unavailable' | 'pending' | 'known' = client.host.capabilityStatus;
  const reactiveCanOpenWindow: boolean = canUseHostCapability(client.host.lifecycle.get(), 'window:open');
  client.host.lifecycle.subscribe(snapshot => console.log(snapshot.available, snapshot.capabilityStatus, snapshot.capabilities));
  // @ts-expect-error Setting values are checked against the application settings type.
  client.host.setSetting('layout', 'invalid');
  // @ts-expect-error Unknown setting paths are rejected.
  client.host.setSetting('missing', true);
  // @ts-expect-error Indexed setting values retain their declared value type.
  client.host.setSetting('labels.player', false);
  // @ts-expect-error Host command payloads must be JSON-compatible.
  client.host.command('example.command', new Date());
  const demoTransport: Transport = createDemoTransport<ExampleSettings>();
  const synchronousTransport: Transport = { name: 'synchronous', open() {} };
  const testingOptions: TestingConnectOptions<ExampleSettings> = { clientId: 'app_example', transport: demoTransport };
  const testingClient = await openClient(testingOptions);
  const readonlyScopes = ['match:read', 'players:read'] as const;
  const scopedClient = await openClient({ clientId: 'app_example', scopes: readonlyScopes });
  const configuredDemo = await openClient<ExampleSettings>({
    clientId: 'app_example',
    demo: { settings: { layout: 'compact' }, surface: 'streamOverlay' }
  });
  const explicitlyOpened = await openClient<ExampleSettings>({ clientId: 'app_example', demo: true });
  const explicitlyStarted = await startClient<ExampleSettings>({ clientId: 'app_example', demo: true });
  const extensionClient = createClient<ExampleSettings, ExampleOverlayExtensions>({ clientId: 'app_example' });
  // @ts-expect-error Settings models must be recursively JSON-compatible.
  createClient<{ readonly loadedAt: Date }>({ clientId: 'invalid_settings' });
  // @ts-expect-error Extension models must be recursively JSON-compatible.
  createClient<ExampleSettings, { readonly cache: Map<string, string> }>({ clientId: 'invalid_extension' });
  // @ts-expect-error SDK-owned overlay branches cannot be declared as extension input.
  createClient<ExampleSettings, { readonly runtime: { readonly custom: boolean } }>({ clientId: 'reserved_extension' });
  // @ts-expect-error Broad string indexes can contain SDK-owned overlay branch names.
  createClient<ExampleSettings, Record<string, string>>({ clientId: 'indexed_extension' });
  // @ts-expect-error Settings are root records; arrays are valid only as nested JSON values.
  createClient<string[]>({ clientId: 'array_settings' });
  // @ts-expect-error Overlay extensions are root records, not arrays.
  createClient<ExampleSettings, string[]>({ clientId: 'array_extensions' });
  // @ts-expect-error Testing settings must be recursively JSON-compatible.
  createDemoState<{ readonly loadedAt: Date }>();
  // @ts-expect-error Testing overlay extensions cannot shadow normalization-owned branches.
  createDemoTransport<ExampleSettings, { readonly settings: { readonly custom: boolean } }>();
  // @ts-expect-error Testing overlay extensions cannot use an unrestricted string index.
  createDemoState<ExampleSettings, Record<string, string>>();
  // @ts-expect-error Demo settings use the same non-array root-record contract.
  createDemoState<string[]>();
  const extensionRound: number | undefined = extensionClient.state.get()?.overlay?.tournament.round;
  const extensionState = extensionClient.state.get();
  if (extensionState?.overlay) {
    // @ts-expect-error Extension state is deeply immutable like the built-in state model.
    extensionState.overlay.tournament.round = 2;
  }
  type InvalidOverlay = import('../src/index.js').OverlayState<{ runtime: { custom: boolean } }>;
  // @ts-expect-error runtime is owned by normalization and cannot be declared as an extension branch.
  const invalidOverlay: InvalidOverlay = { runtime: { custom: true } };
  extensionClient.on('state.changed', event => console.log(event.state.overlay?.tournament.round));
  const groupedHistory: readonly PlayerTeam<HistoryPlayer>[] = groupPlayersByTeam<HistoryPlayer>([
    { team: null, name: 'Unknown side' }, { team: 1, name: 'Two' }
  ]);
  const orderedHistory: readonly PlayerTeam<OrderedHistoryPlayer>[] = standardGame.orderMatchTeams<OrderedHistoryPlayer>([
    { id: 'unknown', team: null, name: 'Unknown side' }, { id: 'two', team: 1, name: 'Two' }
  ], { mode: '1v1' });
  const memoizedNames = createMemoizedSelector((players: readonly HistoryPlayer[]) => players.map(player => player.name));
  const immutableHistory = Object.freeze([{ team: 0, name: 'One' }] satisfies HistoryPlayer[]);
  const stableNames: string[] = memoizedNames(immutableHistory);
  const historyBroadcaster: HistoryPlayer | null = broadcasterPlayer(
    { broadcasterPlayerId: 'One' },
    [{ team: 0, name: 'One', id: 'One' }]
  );
  const historyIdentity = playerDisplayIdentity({ id: 'One', name: 'One', mainAccount: { name: 'Account' } });
  const normalizedHistoryIdentity = playerDisplayIdentity(
    { id: 'One', name: 'One#1234' },
    { stripBattleTagDiscriminator: true }
  );
  const application = defineApplication<ExampleSettings, readonly ['match:read']>({
    clientId: 'app_example',
    revision: 'revision',
    scopes: ['match:read'],
    settingsDefaults: { layout: 'compact' }
  });
  // @ts-expect-error Generated application settings defaults must be a root record.
  defineApplication<string[], readonly ['match:read']>({
    clientId: 'array_settings', revision: 'revision', scopes: ['match:read'], settingsDefaults: []
  });
  // @ts-expect-error Generated application revisions are owned by the binding and cannot be overridden.
  application.createClient({ applicationRevision: 'ignored' });
  const applicationRuntime = application.createRuntime<ExampleOverlayExtensions>({ demo: { interval: 0 } });
  // @ts-expect-error Generated runtimes reject non-JSON extension models even without an options argument.
  application.createRuntime<{ readonly cache: Map<string, string> }>();
  // @ts-expect-error Generated clients reject SDK-owned overlay extension branches.
  application.createClient<{ readonly misc: { readonly custom: boolean } }>();
  const runtimeSignal: AbortSignal = applicationRuntime.signal;
  applicationRuntime.client.on('issue', event => console.log(event), { signal: runtimeSignal });
  applicationRuntime.lifecycle.subscribe(snapshot => {
    const resolvedLayout: 'compact' | 'wide' = snapshot.settings.layout;
    const runtimeState: MatchState<DeepPartial<ExampleSettings>, ExampleOverlayExtensions> | null = snapshot.state;
    console.log(resolvedLayout, runtimeState?.overlay?.tournament.round, canUseHostCapability(snapshot.host, 'window:open'));
  });
  const runtimeCallerWait: ApplicationRuntimeStartOptions = {
    until: 'synchronized', timeout: 5000, signal: abortController.signal
  };
  await applicationRuntime.start(runtimeCallerWait);
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
  state.gameContext.hudScael;
  const composition = await getOverlayComposition({ surface: 'streamOverlay' });
  const permissionError = new PermissionRequiredError('permission', 'https://w3booster.com/authorize');
  const connectionError = new ConnectionError('connection', [permissionError]);
  const protocolError = new ProtocolError('INVALID_TEST', 'protocol', { field: 'value' });
  const development: boolean | undefined = composition[0]?.development;
  console.log(layout, player, store, scopes, message, synchronizedState, state ? store.isSynchronized : false, context.hudScale, archmageIcon, archmageIconUrl, specializedIconUrl, specializedCooldown, heroIcon, germanFlagUrl, heroLevel, raceLocalizationKey, broadcaster, teams, orderedTeams, presentationTeams, orderedPlayers, orderedPair, scopedPair, inventory, stableRuntime, inventoryKey, current, upgradeKey, presentationColor, displayLevel, resourcesAvailable, resources, resourcesOrZero, fixture, cooldown, cooldowns, resolvedSettings, recorderClient.diagnostics.localTransport, testingOptions, testingClient, synchronousTransport, scopedClient, configuredDemo, explicitlyOpened, explicitlyStarted, extensionRound, invalidOverlay, groupedHistory, historyBroadcaster, historyIdentity, stableNames, statusStore.get(), statusSubscribable, composition, development, connectionError, protocolError, hostCapabilities, canOpenWindow, hostCapabilityStatus, windowResult, commandResult);
}

void useSdk;
