import { cp, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entries = [
  ['settings', 'Settings'],
  ['compositor', 'Compositor'],
  ['testing', 'Testing'],
  ['react', 'React']
];
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'w3booster-runtime-contracts-'));

try {
  const temporarySource = path.join(temporaryRoot, 'src');
  await cp(path.join(root, 'src'), temporarySource, { recursive: true });
  await cp(path.join(root, 'api-source'), path.join(temporaryRoot, 'api-source'), { recursive: true });
  for (const [entry] of entries) {
    await copyFile(
      path.join(temporarySource, `${entry}.js`),
      path.join(temporarySource, `${entry}.runtime-contract.mjs`)
    );
  }

  const modulePath = target => {
    const relative = path.relative(temporaryRoot, target).split(path.sep).join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  };
  const imports = entries.flatMap(([entry, identifier]) => [
    `import * as Public${identifier} from '${modulePath(path.join(root, 'src', `${entry}.js`))}';`,
    `import * as Runtime${identifier} from './src/${entry}.runtime-contract.mjs';`
  ]);
  const assignments = entries.map(([_entry, identifier]) =>
    `const checked${identifier}: typeof Public${identifier} = Runtime${identifier};`);
  const checker = [
    '/* Generated in a temporary directory by check-direct-runtime-contracts.mjs. */',
    ...imports,
    '',
    ...assignments,
    '',
    `void [${entries.map(([_entry, identifier]) => `checked${identifier}`).join(', ')}];`,
    ''
  ].join('\n');
  await writeFile(path.join(temporaryRoot, 'contracts.ts'), checker);
  await writeFile(path.join(temporaryRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      allowJs: true,
      checkJs: true,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      noImplicitAny: false,
      skipLibCheck: true,
      strict: true,
      target: 'ES2022'
    },
    files: [
      'contracts.ts',
      ...entries.map(([entry]) => `src/${entry}.runtime-contract.mjs`)
    ]
  }, null, 2));

  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p', path.join(temporaryRoot, 'tsconfig.json')
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
