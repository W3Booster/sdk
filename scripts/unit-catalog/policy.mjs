// Keep fields useful to overlays, army/economy analysis, tooltips and tech-tree
// consumers. This is a source projection, not a claim about current live stats.
export const TABLE_FIELDS = {
  unitabilities: ['abilList', 'auto', 'heroAbilList'],
  unitbalance: [
    'goldcost', 'lumbercost', 'fused', 'fmade', 'bldtm', 'goldRep', 'lumberRep', 'reptm',
    'HP', 'manaN', 'mana0', 'regenHP', 'regenMana', 'regenType',
    'def', 'defType', 'defUp', 'spd', 'minSpd', 'maxSpd', 'collision', 'sight', 'nsight',
    'isbldg', 'level', 'type', 'upgrades',
    'STR', 'STRplus', 'AGI', 'AGIplus', 'INT', 'INTplus', 'Primary',
    'stockInitial', 'stockMax', 'stockRegen', 'stockStart',
    'bountydice', 'bountyplus', 'bountysides',
    'lumberbountydice', 'lumberbountyplus', 'lumberbountysides',
  ],
  unitdata: ['race', 'movetp', 'turnRate', 'targType', 'cargoSize', 'canSleep', 'deathType'],
  unitui: ['campaign'],
  unitweapons: [
    'weapsOn', 'acquire', 'minRange', 'castpt', 'castbsw',
    ...[1, 2].flatMap(attack => [
      'dmgplus', 'dice', 'sides', 'dmgUp', 'atkType', 'weapTp', 'targs',
      'rangeN', 'RngBuff', 'cool', 'dmgpt', 'backSw', 'targCount', 'damageLoss',
      'Farea', 'Harea', 'Hfact', 'Qarea', 'Qfact', 'splashTargs', 'spillDist', 'spillRadius',
    ].map(field => `${field}${attack}`)),
  ],
};

const PROFILE_FIELDS = new Set([
  'requires', 'requiresamount', 'requirescount',
  ...Array.from({ length: 8 }, (_, index) => `requires${index + 1}`),
  'dependencyor', 'trains', 'builds', 'researches', 'upgrade',
  'sellunits', 'sellitems', 'makeitems', 'revive', 'reviveat',
  'missilespeed', 'missilehoming',
]);

export function keepGameplayField(group, source, field) {
  if (group === 'tables') return TABLE_FIELDS[source]?.includes(field) ?? false;
  const base = field.split(':', 1)[0].toLowerCase();
  if (source.endsWith('unitfunc.txt')) return PROFILE_FIELDS.has(base);
  if (source.startsWith('_locales/enus.w3mod/') && source.endsWith('unitstrings.txt')) {
    return base === 'name';
  }
  return false;
}

export function projectGameplay(sources) {
  const gameplay = {};
  const dropped = {};
  for (const [source, records] of Object.entries(sources)) {
    const slash = source.indexOf('/');
    const group = source.slice(0, slash);
    const name = source.slice(slash + 1);
    const rows = {};
    for (const [id, fields] of Object.entries(records)) {
      const selected = {};
      for (const [key, value] of Object.entries(fields)) {
        if (keepGameplayField(group, name, key)) selected[key] = value;
        else (dropped[source] ??= new Set()).add(key);
      }
      if (Object.keys(selected).length) rows[id] = selected;
    }
    if (Object.keys(rows).length) gameplay[source] = rows;
  }
  return {
    gameplay,
    droppedFields: Object.fromEntries(Object.entries(dropped).map(([source, keys]) =>
      [source, [...keys].sort()])),
  };
}
