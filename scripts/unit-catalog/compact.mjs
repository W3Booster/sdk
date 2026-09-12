#!/usr/bin/env node
// Usage: node scripts/unit-catalog/compact.mjs SOURCE.json OUTPUT_DIRECTORY
// Consumes the source extraction prototype; never reads a game installation or
// publishes assets. Generated files deliberately stay outside the npm package.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { isCurrentField, packSources, unpackSources } from './format.mjs';
import { projectGameplay } from './policy.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/unit-catalog/compact.mjs SOURCE.json OUTPUT_DIRECTORY');
}
const sourceBytes = await readFile(input);
const source = JSON.parse(sourceBytes.toString('utf8'));
assert.equal(source.schemaVersion, 1, 'Unsupported source schema');
assert.equal(source.scope, 'base-game source records, not a resolved World Editor model');
assert.equal(typeof source.gameVersion, 'string');
assert(source.gameVersion.length > 0);

const tables = ['unitabilities', 'unitbalance', 'unitdata', 'unitui', 'unitweapons'];
const sources = {};
const excluded = {};
for (const [id, unit] of Object.entries(source.units)) {
  for (const [group, records] of Object.entries(unit)) {
    assert(['tables', 'profiles'].includes(group), `Unknown source group ${group}`);
    for (const [name, record] of Object.entries(records)) {
      // The input scope promises main game sources. Reject a mixed archive dump
      // rather than silently treating legacy files as current.
      if (group === 'tables') assert(tables.includes(name), `Unknown unit table ${name}`);
      else assert(!name.includes('_balance/'), `Legacy source in base input: ${name}`);
      const filtered = Object.fromEntries(Object.entries(record).filter(([key]) => {
        if (isCurrentField(key)) return true;
        excluded[key] = (excluded[key] ?? 0) + 1;
        return false;
      }));
      (sources[`${group}/${name}`] ??= {})[id] = filtered;
    }
  }
}
for (const table of tables) assert(sources[`tables/${table}`], `Missing ${table}`);

// Keep the full research input for auditing, but only produce SDK-relevant
// gameplay fields. The stats projection is an even smaller optional subset.
const { gameplay, droppedFields } = projectGameplay(sources);
const statColumns = [
  'goldcost', 'lumbercost', 'fused', 'fmade', 'HP', 'manaN', 'mana0', 'bldtm',
  'isbldg', 'level', 'spd', 'def', 'regenHP', 'regenMana', 'STR', 'STRplus',
  'AGI', 'AGIplus', 'INT', 'INTplus',
];
const stats = { 'tables/unitbalance': Object.fromEntries(
  Object.entries(sources['tables/unitbalance']).map(([id, record]) => [id,
    Object.fromEntries(statColumns.filter(key => Object.hasOwn(record, key))
      .map(key => [key, record[key]])),
  ]),
) };
const metadata = {
  gameVersion: source.gameVersion,
  ruleset: 'current-melee',
  scope: 'Selected gameplay source records; not resolved live unit stats',
  sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
};
const budgets = {
  'unit-stats': { bytes: 64 * 1024, gzipBytes: 12 * 1024 },
  'unit-gameplay': { bytes: 320 * 1024, gzipBytes: 64 * 1024 },
};
const report = {
  ...metadata,
  sourceBytes: sourceBytes.length,
  unitTypes: Object.keys(source.units).length,
  statRecords: Object.keys(stats['tables/unitbalance']).length,
  excludedLegacyValues: Object.values(excluded).reduce((a, b) => a + b, 0),
  excludedLegacyKeys: excluded,
  droppedFields,
  selectedSourceColumnCount: Object.values(gameplay).reduce((total, records) => total +
    new Set(Object.values(records).flatMap(record => Object.keys(record))).size, 0),
  budgets,
  roundTripVerified: false,
  artifacts: {},
};

const artifacts = [];
for (const [name, records] of Object.entries({
  'unit-stats': stats,
  'unit-gameplay': gameplay,
})) {
  const packed = packSources(records);
  const bytes = Buffer.from(JSON.stringify({ ...metadata, ...packed }) + '\n');
  // Check the serialized artifact, including every original string, explicit
  // empty value and absent field. Never coerce dash/underscore sentinels to zero.
  assert.deepEqual(unpackSources(JSON.parse(bytes.toString('utf8'))), records);
  const gzip = gzipSync(bytes, { level: 9 });
  const brotli = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  assert(bytes.length <= budgets[name].bytes, `${name} exceeds its uncompressed size budget`);
  assert(gzip.length <= budgets[name].gzipBytes, `${name} exceeds its gzip size budget`);
  artifacts.push([`${name}.json`, bytes], [`${name}.json.gz`, gzip], [`${name}.json.br`, brotli]);
  report.artifacts[name] = {
    bytes: bytes.length, gzipBytes: gzip.length, brotliBytes: brotli.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
report.roundTripVerified = true;
// Finish every validation before replacing any previous successful artifacts.
await mkdir(output, { recursive: true });
for (const [name, bytes] of artifacts) await writeFile(join(output, name), bytes);
await writeFile(join(output, 'size-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: resolve(output), ...report }, null, 2));
