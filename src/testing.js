import { PROTOCOL_VERSION } from './version.js';

/** Create a deterministic in-browser data source for SDK and application tests. */
export function createDemoTransport(options = {}) {
  let timer;
  let sequence = 0;
  const state = clone(options.state || createDemoState());
  return {
    name: 'demo',
    async open(context) {
      context.onMessage({ version: PROTOCOL_VERSION, sequence: ++sequence, type: 'state.snapshot', data: state });
      timer = setInterval(() => {
        state.match.gameTime += 1;
        state.players[0].resources.gold += 7;
        state.players[1].resources.gold += 6;
        context.onMessage({ version: PROTOCOL_VERSION, sequence: ++sequence, type: 'state.snapshot', data: state });
      }, options.interval || 1000);
    },
    close() { clearInterval(timer); },
    resync() { }
  };
}

function createDemoState() {
  return {
    capabilities: ['match', 'players', 'heroes', 'resources'],
    match: { id: 'demo-match', status: 'running', gameTime: 0, mode: '1v1', map: 'Echo Isles', realm: 'W3Champions' },
    players: [
      { id: '0', name: 'Northwind', race: 'human', team: 0, resources: { gold: 520, lumber: 185, supply: 34, supplyCap: 50 }, heroes: [{ id: 'Hamg', name: 'Archmage', level: 4 }] },
      { id: '1', name: 'Ironclaw', race: 'orc', team: 1, resources: { gold: 470, lumber: 210, supply: 38, supplyCap: 50 }, heroes: [{ id: 'Obla', name: 'Blademaster', level: 4 }] }
    ]
  };
}

function clone(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
