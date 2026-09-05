import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generateSettingsBinding } from '../src/settings.js';

const run = promisify(execFile);
const repository = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const typescript = join(repository, 'node_modules', 'typescript', 'bin', 'tsc');

test('the packed package resolves every public entry point for TypeScript consumers', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'w3booster-sdk-package-'));
  const consumerDirectory = join(temporaryDirectory, 'consumer');
  try {
    await mkdir(consumerDirectory);
    const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', temporaryDirectory], {
      cwd: repository,
      env: { ...process.env, npm_config_ignore_scripts: 'true' }
    });
    const [{ filename }] = JSON.parse(stdout);
    const tarball = join(temporaryDirectory, filename);

    await writeFile(join(consumerDirectory, 'package.json'), JSON.stringify({
      private: true,
      type: 'module'
    }, null, 2));
    await run('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball], {
      cwd: consumerDirectory
    });
    const definitionPath = join(consumerDirectory, 'settings.json');
    const generatedPath = join(consumerDirectory, 'w3booster.generated.ts');
    await writeFile(definitionPath, JSON.stringify({
      clientId: 'package_consumer',
      revision: 'package-test',
      scopes: ['match:read'],
      settingsSchema: {
        version: 1,
        sections: [{
          id: 'display', title: 'Display', groups: [{ id: 'layout', title: 'Layout' }],
          fields: [{
            key: 'display.layout', label: 'Layout', type: 'select', default: 'wide', group: 'layout',
            options: [{ label: 'Wide', value: 'wide' }, { label: 'Compact', value: 'compact' }]
          }]
        }]
      }
    }));
    const definition = JSON.parse(await readFile(definitionPath, 'utf8'));
    await writeFile(generatedPath, generateSettingsBinding(definition));
    await writeFile(join(consumerDirectory, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'DOM'],
        skipLibCheck: false
      },
      include: ['consumer.ts']
    }, null, 2));
    await writeFile(join(consumerDirectory, 'consumer.ts'), `
import { openClient, startClient, type MatchState } from '@w3booster/sdk';
import { broadcasterPlayer } from '@w3booster/sdk/selectors';
import { heroExperienceState } from '@w3booster/sdk/standard-game';
import { iconUrl } from '@w3booster/sdk/standard-game/icons';
import { heroIconUrl } from '@w3booster/sdk/standard-game/icons';
import { getAbilityCooldown } from '@w3booster/sdk/standard-game/cooldowns';
import { countryFlagUrl } from '@w3booster/sdk/assets';
import { getOverlayComposition } from '@w3booster/sdk/compositor';
import { createDemoTransport, type TestingConnectOptions } from '@w3booster/sdk/testing';
import { validateSettingsSchema } from '@w3booster/sdk/settings';
import { defineApplication } from '@w3booster/sdk/app';
import { createReactStore } from '@w3booster/sdk/react';
import { createSelectorStore } from '@w3booster/sdk/store';
import {
  w3boosterApp,
  type W3BoosterAppClient,
  type W3BoosterAppConnectOptions,
  type W3BoosterAppRuntime,
  type W3BoosterAppRuntimeSnapshot,
  type W3BoosterAppSettings
} from './w3booster.generated';

interface Settings { layout: 'compact' | 'wide' }
const options: TestingConnectOptions<Settings> = {
  clientId: 'package_consumer',
  transport: createDemoTransport<Settings>()
};
const clientPromise = openClient(options);
const externalStore = createReactStore({ get: () => 1, subscribe: listener => { listener(1); return () => undefined; } });
const selectedStore = createSelectorStore({ get: () => 1, subscribe: listener => { listener(1); return () => undefined; } }, value => String(value));
const openedClient = openClient(options);
const startedClient = startClient({ clientId: 'package_consumer', demo: true });
declare const state: MatchState<Settings>;
const player = broadcasterPlayer(state.match, state.players);
const experience = heroExperienceState(500);
const icon = iconUrl('Hamg');
const heroIcon = heroIconUrl({ id: 'Hamg' });
const abilityCooldown = getAbilityCooldown('AHbz', 1);
const flag = countryFlagUrl('DE');
const composition = getOverlayComposition({ surface: 'streamOverlay' });
const schema = validateSettingsSchema<Settings>({ version: 1, sections: [] });
const app = defineApplication<Settings, readonly ['match:read']>({
  clientId: 'package_consumer', revision: 'package-test', scopes: ['match:read'], settingsDefaults: { layout: 'wide' }
});
const generatedSettings: W3BoosterAppSettings = { display: { layout: 'compact' } };
const generatedClient = w3boosterApp.open({ demo: { settings: generatedSettings } });
const generatedLifecycleClient = w3boosterApp.createClient({ demo: { settings: generatedSettings } });
interface OverlayExtensions { broadcast: { label: string } }
declare const typedGeneratedClient: W3BoosterAppClient<OverlayExtensions>;
declare const typedGeneratedRuntime: W3BoosterAppRuntime<OverlayExtensions>;
declare const typedGeneratedSnapshot: W3BoosterAppRuntimeSnapshot<OverlayExtensions>;
const typedGeneratedOptions: W3BoosterAppConnectOptions<OverlayExtensions> = {};
const overlayLabel: string | undefined = typedGeneratedClient.state.get()?.overlay?.broadcast.label;
const runtimeOverlayLabel: string | undefined = typedGeneratedRuntime.client.state.get()?.overlay?.broadcast.label;
const snapshotOverlayLabel: string | undefined = typedGeneratedSnapshot.state?.overlay?.broadcast.label;
void [clientPromise, openedClient, startedClient, externalStore, selectedStore, generatedClient, generatedLifecycleClient, typedGeneratedOptions, overlayLabel, runtimeOverlayLabel, snapshotOverlayLabel, player, experience, icon, heroIcon, abilityCooldown, flag, composition, schema, app];
`);

    const runtimeResult = await run(process.execPath, ['--input-type=module', '--eval', `
await Promise.all([
  '@w3booster/sdk',
  '@w3booster/sdk/selectors',
  '@w3booster/sdk/standard-game',
  '@w3booster/sdk/standard-game/icons',
  '@w3booster/sdk/standard-game/cooldowns',
  '@w3booster/sdk/assets',
  '@w3booster/sdk/compositor',
  '@w3booster/sdk/settings',
  '@w3booster/sdk/app',
  '@w3booster/sdk/react',
  '@w3booster/sdk/store',
  '@w3booster/sdk/testing'
].map(entryPoint => import(entryPoint)));
`], { cwd: consumerDirectory });
    assert.equal(runtimeResult.stderr, '');

    const result = await run(process.execPath, [typescript, '-p', join(consumerDirectory, 'tsconfig.json')], {
      cwd: consumerDirectory
    });
    assert.equal(result.stderr, '');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
