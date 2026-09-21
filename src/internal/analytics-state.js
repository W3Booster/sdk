import { validTimedProgress } from './unit-state.js';
const analyticsRecord = value => !!value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const analyticsCount = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const analyticsTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const analyticsTypes = (value, check) => analyticsRecord(value) && Object.keys(value).length <= 999 &&
  Object.entries(value).every(([key, entry]) => /^[A-Za-z0-9]{4}$/.test(key) && check(entry));
const analyticsDamage = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validAbilityStatistics = value => analyticsRecord(value) &&
  (value.level === undefined || analyticsCount(value.level)) &&
  (value.isHeroAbility === undefined || typeof value.isHeroAbility === 'boolean') &&
  (value.cooldown === undefined || validTimedProgress(value.cooldown)) && ['damageDealt', 'healingDone'].every(key => analyticsDamage(value[key]));
const validHeroStatistics = value => analyticsRecord(value) && typeof value.typeId === 'string' && /^[A-Z][A-Za-z0-9]{3}$/.test(value.typeId) &&
  (value.level === undefined || analyticsCount(value.level) && value.level > 0) &&
  (value.nextLevelExperience === undefined || analyticsCount(value.nextLevelExperience)) &&
  ['deaths', 'totalKills', 'heroKills', 'selfKills', 'buildingKills', 'timeAliveMs'].every(key => analyticsCount(value[key])) &&
  (value.abilities === undefined || analyticsTypes(value.abilities, validAbilityStatistics));
const validUnitTypeStatistics = value => analyticsRecord(value) && ['currentAmount', 'totalAmount'].every(key => analyticsCount(value[key])) &&
  value.currentAmount <= value.totalAmount && typeof value.isPeon === 'boolean' && typeof value.isFunctionalPeon === 'boolean' &&
  ['damageDealt', 'damageReceived', 'healingDone'].every(key => analyticsDamage(value[key]));
export const validPlayerStatistics = value => analyticsRecord(value) && analyticsTime(value.gameTime) &&
  (value.handicapPercent === undefined || analyticsDamage(value.handicapPercent) && value.handicapPercent <= 1000) &&
  (value.racePreference === undefined || analyticsCount(value.racePreference) && value.racePreference <= 127) &&
  (value.playerRace === undefined || analyticsCount(value.playerRace) && value.playerRace <= 11) &&
  (value.realTimeApm === undefined || analyticsCount(value.realTimeApm)) &&
  ['slotState', 'aiDifficulty'].every(key => value[key] === undefined || [0,1,2].includes(value[key])) &&
  (value.timeInUpkeepMs === undefined || Array.isArray(value.timeInUpkeepMs) && value.timeInUpkeepMs.length === 10 && value.timeInUpkeepMs.every(analyticsCount)) &&
  (value.units === undefined || analyticsTypes(value.units, validUnitTypeStatistics)) &&
  (value.heroes === undefined || analyticsRecord(value.heroes) && Object.keys(value.heroes).length <= 256 &&
    Object.entries(value.heroes).every(([id, hero]) => /^[0-9a-f]{16}$/.test(id) && validHeroStatistics(hero))) &&
  ['goldMined', 'goldUpkeepLost', 'goldCredited', 'goldDiversionTax', 'lumberCredited', 'lumberUpkeepLost', 'lumberDiversionTax'].every(key => value[key] === undefined || analyticsCount(value[key])) &&
  (value.items === undefined || analyticsTypes(value.items, item => analyticsRecord(item) &&
    ['collected', 'purchased', 'sold', 'used', 'destroyed'].every(key => analyticsCount(item[key])) &&
    ['damageDealt', 'healingDone'].every(key => item[key] === undefined || analyticsCount(item[key]))));
export const validPlayerLosses = value => analyticsRecord(value) && analyticsTime(value.gameTime) && typeof value.complete === 'boolean' &&
  (value.units === undefined || analyticsTypes(value.units, analyticsCount)) &&
  (value.buildings === undefined || analyticsTypes(value.buildings, analyticsCount));
export const validMatchOutcomes = value => analyticsRecord(value) && Object.keys(value).length <= 24 &&
  Object.entries(value).every(([key, entry]) => /^(?:[0-9]|1[0-9]|2[0-3])$/.test(key) && typeof entry === 'string' && ['won', 'lost', 'draw'].includes(entry));
