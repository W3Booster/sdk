import { deepEqual } from './values.js';

export function isActiveMatch(match) {
  return match?.status === 'starting' || match?.status === 'running';
}

export function isObserverOrReplayMatch(match) {
  return match?.isObserver === true || match?.isReplay === true;
}

export function hasCapability(state, capability) {
  return Array.isArray(state?.capabilities) && state.capabilities.includes(capability);
}

/** Project immutable state transitions into the SDK's semantic event stream. */
export function emitDomainEvents(previous, state, emit) {
  emit('state.changed', { state, previousState: previous, initial: !previous });
  if (!previous) {
    emit('state.ready', { state });
    return;
  }

  const previousMatch = previous.match || {};
  const match = state.match || {};
  const sameMatch = String(previousMatch.id || '') === String(match.id || '');
  const wasActive = isActiveMatch(previousMatch);
  const isActive = isActiveMatch(match);
  if (wasActive && (!isActive || !sameMatch)) emit('match.ended', { match: previousMatch, nextMatch: match, state });
  if (isActive && (!wasActive || !sameMatch)) emit('match.started', { match, previousMatch, state });
  if (!deepEqual(previousMatch, match)) {
    emit('match.changed', { match, previousMatch, changedFields: changedKeys(previousMatch, match), state });
  }
  if (!deepEqual(previous.application?.settings, state.application?.settings)) {
    emit('application.settings.changed', {
      settings: state.application?.settings,
      previousSettings: previous.application?.settings,
      application: state.application,
      state
    });
  }

  const previousPlayers = indexById(previous.players);
  const players = indexById(state.players);
  const playerIds = new Set([...previousPlayers.keys(), ...players.keys()]);
  playerIds.forEach(playerId => {
    const previousPlayer = previousPlayers.get(playerId);
    const player = players.get(playerId);
    const playerContext = { playerId, player: player || previousPlayer, previousPlayer, state };
    if (!previousPlayer && player) emit('player.added', playerContext);
    if (previousPlayer && !player) {
      emitRemovedHeroes(playerId, previousPlayer, state, emit);
      emit('player.removed', playerContext);
      return;
    }
    if (!previousPlayer || !player) return;

    if (!deepEqual(previousPlayer, player)) {
      emit('player.changed', { ...playerContext, changedFields: changedKeys(previousPlayer, player) });
    }
    emitValueChange('player.resources.changed', playerContext, 'resources', previousPlayer.resources, player.resources, emit);
    emitValueChange('player.stats.changed', playerContext, 'stats', previousPlayer.stats, player.stats, emit);
    emitValueChange('player.upgrades.changed', playerContext, 'upgrades', previousPlayer.upgrades, player.upgrades, emit);
    emitHeroEvents(playerId, previousPlayer, player, state, emit);
  });
}

function emitValueChange(type, context, key, previousValue, value, emit) {
  if (!deepEqual(previousValue, value)) emit(type, { ...context, [key]: value, [`previous${capitalize(key)}`]: previousValue });
}

function emitHeroEvents(playerId, previousPlayer, player, state, emit) {
  const previousHeroes = indexById(previousPlayer.heroes);
  const heroes = indexById(player.heroes);
  const heroIds = new Set([...previousHeroes.keys(), ...heroes.keys()]);
  heroIds.forEach(heroId => {
    const previousHero = previousHeroes.get(heroId);
    const hero = heroes.get(heroId);
    const context = { playerId, player, heroId, hero: hero || previousHero, previousHero, state };
    if (!previousHero && hero) {
      emit('hero.added', context);
      return;
    }
    if (previousHero && !hero) {
      emit('hero.removed', context);
      return;
    }
    if (!previousHero || !hero || deepEqual(previousHero, hero)) return;
    emit('hero.changed', { ...context, changedFields: changedKeys(previousHero, hero) });
    const previousInventory = previousHero.inventory || [];
    const inventory = hero.inventory || [];
    if (!deepEqual(previousInventory, inventory)) {
      emit('hero.inventory.changed', { ...context, inventory, previousInventory });
    }
    if (!deepEqual(previousHero.abilities, hero.abilities)) {
      emit('hero.abilities.changed', { ...context, abilities: hero.abilities || [], previousAbilities: previousHero.abilities || [] });
    }
  });
}

function emitRemovedHeroes(playerId, player, state, emit) {
  indexById(player.heroes).forEach((hero, heroId) => {
    emit('hero.removed', { playerId, player, heroId, hero, previousHero: hero, state });
  });
}

function indexById(values) {
  return new Map((values || []).map((value, index) => [String(value?.id ?? index), value]));
}

function changedKeys(previous, current) {
  return Array.from(new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]))
    .filter(key => !deepEqual(previous?.[key], current?.[key]));
}

function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
