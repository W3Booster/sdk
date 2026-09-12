// Lossless packing for extracted string-valued source records. This is an
// internal research format, not a public SDK contract or World Editor resolver.
export function packSources(sources) {
  const frequencies = new Map();
  for (const rows of Object.values(sources)) {
    for (const record of Object.values(rows)) {
      for (const value of Object.values(record)) {
        if (typeof value !== 'string') throw new TypeError('Source values must be strings');
        frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
      }
    }
  }
  const values = [...frequencies.keys()].sort((a, b) =>
    frequencies.get(b) - frequencies.get(a) || compare(a, b));
  const indices = new Map(values.map((value, index) => [value, index]));
  const blocks = Object.keys(sources).sort().map(name => {
    const records = sources[name];
    const ids = Object.keys(records).sort();
    const columns = [...new Set(ids.flatMap(id => Object.keys(records[id])))].sort();
    const defaults = columns.map(key => {
      const counts = new Map();
      for (const id of ids) {
        const value = Object.hasOwn(records[id], key) ? indices.get(records[id][key]) : -1;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a - b)[0];
    });
    const rows = Object.fromEntries(ids.map(id => [id, columns.flatMap((key, index) => {
      const value = Object.hasOwn(records[id], key) ? indices.get(records[id][key]) : -1;
      return value === defaults[index] ? [] : [index, value];
    })]));
    return { name, columns, defaults, rows };
  });
  return { format: 'w3-unit-source-columns-v1', values, blocks };
}

export function unpackSources(packed) {
  if (packed.format !== 'w3-unit-source-columns-v1') throw new Error('Unknown packed format');
  return Object.fromEntries(packed.blocks.map(block => [block.name,
    Object.fromEntries(Object.entries(block.rows).map(([id, overrides]) => {
      const row = [...block.defaults];
      for (let i = 0; i < overrides.length; i += 2) row[overrides[i]] = overrides[i + 1];
      return [id, Object.fromEntries(row.flatMap((value, index) =>
        value === -1 ? [] : [[block.columns[index], packed.values[value]]]))];
    })),
  ]));
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Retain current melee qualifiers and both SD/HD art variants. Do not infer
// precedence or rename qualified properties until the editor resolver exists.
export function isCurrentField(key) {
  const qualifiers = key.split(':').slice(1).flatMap(part => part.toLowerCase().split(','));
  if (qualifiers.includes('custom')) return false;
  if (qualifiers.includes('melee')) {
    const versions = qualifiers.filter(value => /^v\d+$/.test(value));
    if (versions.length !== 1 || !['v0', 'v1'].includes(versions[0])) {
      throw new Error(`Unrecognized balance qualifier: ${key}`);
    }
    return versions[0] === 'v1';
  }
  if (qualifiers.some(value => /^v\d+$/.test(value))) {
    throw new Error(`Unrecognized balance qualifier: ${key}`);
  }
  return true;
}
