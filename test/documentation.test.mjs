import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as standardGame from '../src/standard-game.js';
import * as standardGameCooldowns from '../src/standard-game-cooldowns.js';
import * as standardGameIcons from '../src/standard-game-icons.js';

const documentedNamespaces = {
  standardGame,
  standardGameCooldowns,
  standardGameIcons
};

test('README namespace calls resolve to public runtime functions', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const calls = readme.matchAll(
    /\b(standardGame|standardGameCooldowns|standardGameIcons)\.([A-Za-z_$][\w$]*)\s*\(/g
  );
  let count = 0;
  for (const [, namespace, member] of calls) {
    count += 1;
    assert.equal(
      typeof documentedNamespaces[namespace][member],
      'function',
      `README references missing ${namespace}.${member}()`
    );
  }
  assert.ok(count > 0, 'README must keep at least one checked public namespace example');
});
