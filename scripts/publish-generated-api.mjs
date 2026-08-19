import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = resolve(root, '.generated-public-api');
const checkOnly = process.argv.includes('--check');
const outputs = [
  'index.js',
  'index.d.ts',
  'contracts.js',
  'contracts.d.ts',
  'version.js',
  'version.d.ts',
  'selectors.js',
  'selectors.d.ts',
  'store.js',
  'store.d.ts',
  'app.js',
  'app.d.ts',
  'standard-game.js',
  'standard-game.d.ts',
  'assets.js',
  'assets.d.ts'
];

const contracts = [
  'selectors-contracts.d.ts',
  'store-contracts.d.ts',
  'app-contracts.d.ts',
  'standard-game-contracts.d.ts',
  'assets-contracts.d.ts'
];

const pairs = [
  ...outputs.map(output => [resolve(generated, output), resolve(root, 'src', output), output]),
  ...contracts.map(contract => [resolve(root, 'api-source', contract), resolve(root, 'src', contract), contract])
];

try {
  if (checkOnly) {
    const stale = [];
    for (const [source, target, name] of pairs) {
      const expected = await readFile(source);
      const actual = await readFile(target).catch(() => null);
      if (!actual?.equals(expected)) stale.push(name);
    }
    if (stale.length) {
      throw new Error(`Generated public API files are stale: ${stale.join(', ')}. Run npm run build:api.`);
    }
  } else {
    await Promise.all(pairs.map(async ([source, target]) => {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }));
  }
} finally {
  await rm(generated, { recursive: true, force: true });
}
