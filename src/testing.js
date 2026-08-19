import { PROTOCOL_VERSION } from './version.js';
import { structuredCloneSafe as clone } from './internal/values.js';

/** Create a deterministic in-browser data source for SDK and application tests. */
export function createDemoTransport(options = {}) {
  let timer;
  let sequence = 0;
  const interval = options.interval === undefined ? 1000 : Number(options.interval);
  if (!Number.isFinite(interval) || interval < 0) throw new TypeError('demo interval must be a non-negative number');
  const state = clone(options.state || createDemoState({ overlayExtensions: options.overlayExtensions }));
  return {
    name: 'demo',
    async open(context) {
      if (!state.application) {
        state.application = {
          clientId: context.clientId,
          settings: clone(options.settings || {}),
          surface: options.surface || 'application',
          development: true
        };
      }
      context.onMessage({ version: PROTOCOL_VERSION, sequence: ++sequence, type: 'state.snapshot', data: platformState(state) });
      if (interval === 0) return;
      timer = setInterval(() => {
        state.match.gameTime += 1;
        const goldPerTick = [7, 6];
        goldPerTick.forEach((gold, index) => {
          const resources = state.players[index]?.resources;
          if (resources && Number.isFinite(resources.gold)) resources.gold += gold;
        });
        context.onMessage({ version: PROTOCOL_VERSION, sequence: ++sequence, type: 'state.snapshot', data: platformState(state) });
      }, interval);
    },
    close() { clearInterval(timer); },
    resync() { }
  };
}

/** Create a complete deterministic state for application unit tests and demos. */
export function createDemoState(options = {}) {
  const observedAt = 1_700_000_000_000;
  const state = {
    capabilities: ['match', 'players', 'stats', 'heroes', 'upgrades', 'resources', 'controlgroups', 'overlay'],
    match: {
      id: 'demo-match', status: 'running', gameTime: 0, mode: '1v1', map: 'Echo Isles', realm: 'W3Champions',
      broadcasterPlayerId: '0', realBroadcasterPlayerId: '0', isObserver: false, isReplay: false, isReforged: true
    },
    players: [
      {
        id: '0', name: 'Northwind#1234', race: 'human', team: 0, colorId: 0, startPosition: { x: -3200, y: 800 },
        mainAccount: { name: 'Northwind', country: 'DE', mainRace: 'human' },
        stats: { solo: { wins: 42, losses: 18, winRate: 70, rank: 120, league: 'Grandmaster', level: 35 } },
        resources: { gold: 520, lumber: 185, supply: 34, supplyCap: 50, workerSupply: 20 },
        controlgroups: { 1: { frontunit: 'hfoo', size: 8 } },
        heroes: [{
          id: 'Hamg', name: 'Archmage', level: 4, experience: 900,
          hitpoints: { current: 575, max: 650 }, mana: { current: 310, max: 420 },
          abilities: [{ id: 'A0AHwe', name: 'AHwe', level: 2 }], inventory: ['stwp']
        }],
        upgrades: {
          upgrades: [{ name: 'Rhme', level: 1, gametime: observedAt }],
          active: [{ name: 'Rhme', level: 1, gametime: observedAt }], researching: []
        }
      },
      {
        id: '1', name: 'Ironclaw#5678', race: 'orc', team: 1, colorId: 1, startPosition: { x: 3200, y: -800 },
        mainAccount: { name: 'Ironclaw', country: 'SE', mainRace: 'orc' },
        stats: { solo: { wins: 38, losses: 22, winRate: 63.3, rank: 180, league: 'Master', level: 32 } },
        resources: { gold: 470, lumber: 210, supply: 38, supplyCap: 50, workerSupply: 19 },
        controlgroups: { 1: { frontunit: 'ogru', size: 6 } },
        heroes: [{
          id: 'Obla', name: 'Blademaster', level: 4, experience: 900,
          hitpoints: { current: 610, max: 700 }, mana: { current: 190, max: 300 },
          abilities: [{ id: 'A1AOwk', name: 'AOwk', level: 2 }], inventory: ['phea']
        }],
        upgrades: { upgrades: [], active: [], researching: [] }
      }
    ],
    overlay: {
      ...clone(options.overlayExtensions || {}),
      runtime: { hudScale: 1, chatbarOpen: false, matchScore: { wins: 0, losses: 0 }, teamColors: true }
    }
  };
  if (options.clientId) {
    state.application = {
      clientId: options.clientId,
      settings: clone(options.settings || {}),
      surface: options.surface || 'application',
      development: true
    };
  }
  return state;
}

function platformState(state) {
  const snapshot = clone(state);
  if (!snapshot.overlay?.runtime) return snapshot;
  const runtime = snapshot.overlay.runtime;
  const matchScore = runtime.matchScore;
  snapshot.overlay = {
    ...snapshot.overlay,
    misc: {
      ...runtime,
      ...(matchScore ? { matchscoreWins: matchScore.wins, matchscoreLosses: matchScore.losses } : {})
    }
  };
  delete snapshot.overlay.runtime;
  delete snapshot.overlay.misc.matchScore;
  return snapshot;
}
