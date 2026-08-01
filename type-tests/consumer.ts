import type {
  MatchState,
  OverlayRuntimeState,
  Player,
  ProtocolEnvelope,
  Scope,
  StateStore,
  W3BoosterClient
} from '../src/index.js';
import { connect } from '../src/index.js';
import { broadcasterPlayer, groupPlayersByTeam, heroInventory } from '../src/selectors.js';
import type { PlayerTeam } from '../src/selectors.js';
import * as standardGame from '../src/standard-game.js';

interface ExampleSettings {
  layout: 'compact' | 'wide';
  showHeroes?: boolean;
}

async function useSdk() {
  const client: W3BoosterClient<ExampleSettings> = await connect<ExampleSettings>('app_example');
  const state: MatchState<ExampleSettings> = await client.whenReady();
  const layout: 'compact' | 'wide' | undefined = state.application?.settings.layout;
  const player: Player | null = client.state.player('0');
  const store: StateStore<ExampleSettings> = client.match;
  const scopes: Scope[] = ['match:read', 'players:read'];
  const overlayRuntime: OverlayRuntimeState | undefined = state.overlay?.misc;
  const archmageIcon: string | undefined = standardGame.getIcon('Hamg');
  const archmageIconUrl: string | undefined = standardGame.iconUrl('Hamg', { graphics: 'reforged' });
  const heroLevel: number = standardGame.heroExperienceState(500).level;
  const broadcaster: Player | null = broadcasterPlayer(state.match, state.players);
  const teams: PlayerTeam[] = groupPlayersByTeam(state.players);
  const inventory: readonly string[] = heroInventory(state.players[0]?.heroes?.[0]);
  const cooldown = state.players[0]?.heroes?.[0]?.abilities?.[0]
    ? standardGame.abilityCooldown(state.players[0].heroes[0].abilities[0], state.match.gameTime)
    : undefined;
  const message: ProtocolEnvelope<'state.snapshot', MatchState<ExampleSettings>> = {
    version: '1.0',
    sequence: 1,
    type: 'state.snapshot',
    data: state
  };

  client.state.watch(current => current.match.gameTime, seconds => console.log(seconds));
  client.on('hero.changed', event => console.log(event.player.id, event.hero.level, event.changedFields));
  client.on('application.settings.changed', event => console.log(event.settings.layout));
  client.host.setSetting('layout', 'wide');
  console.log(layout, player, store, scopes, message, overlayRuntime?.hudScale, archmageIcon, archmageIconUrl, heroLevel, broadcaster, teams, inventory, cooldown);
}

void useSdk;
