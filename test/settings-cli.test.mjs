import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repository = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const cli = join(repository, 'bin', 'sync-settings.js');
const definition = {
  clientId: 'app_cli', revision: 'revision-cli', scopes: ['match:read'],
  settingsSchema: { version: 1, sections: [] }
};

test('settings CLI fetches a public definition and later infers identity from its generated file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'w3booster-settings-'));
  const outputPath = join(directory, 'generated.ts');
  const server = definitionServer();
  try {
    const endpoint = await listen(server);
    await run(process.execPath, ['bin/sync-settings.js', 'app_cli', '--endpoint', endpoint, '--output', outputPath]);
    const generated = await readFile(outputPath, 'utf8');
    assert.match(generated, /@w3booster-client-id app_cli/);
    assert.match(generated, /revision: "revision-cli"/);

    await run(process.execPath, ['bin/sync-settings.js', '--endpoint', endpoint, '--output', outputPath, '--check']);
    await writeFile(outputPath, `${generated}\n// stale\n`);
    await assert.rejects(
      run(process.execPath, ['bin/sync-settings.js', 'app_cli', '--endpoint', endpoint, '--output', outputPath, '--check']),
      /settings are stale/
    );
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('settings CLI accepts the documented CI endpoint environment variable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'w3booster-settings-env-'));
  const outputPath = join(directory, 'generated.ts');
  const server = definitionServer();
  try {
    const endpoint = await listen(server);
    await run(process.execPath, [cli, 'app_cli', '--output', outputPath], {
      cwd: directory,
      env: { ...process.env, W3BOOSTER_SETTINGS_URL: endpoint }
    });
    assert.match(await readFile(outputPath, 'utf8'), /@w3booster-client-id app_cli/);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('settings CLI init persists its endpoint without mutating project lifecycle scripts by default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'w3booster-settings-init-'));
  const server = definitionServer();
  try {
    const endpoint = await listen(server);
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      private: true,
      scripts: { dev: 'vite', predev: 'node prepare.js', 'start-ssl': 'vite --https', build: 'vite build' }
    }, null, 2));
    await run(process.execPath, [cli, 'init', 'app_cli', '--endpoint', endpoint], { cwd: directory });
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts.predev, 'node prepare.js');
    assert.equal(manifest.scripts['prestart-ssl'], undefined);
    assert.equal(manifest.scripts.prebuild, undefined);
    assert.equal(manifest.scripts.postinstall, undefined);
    assert.equal(manifest.scripts['w3booster:sync'], 'w3booster-settings');
    assert.equal(manifest.scripts['w3booster:check'], 'w3booster-settings --check');
    assert.deepEqual(manifest.w3booster, {
      clientId: 'app_cli',
      settingsOutput: 'src/w3booster.generated.ts',
      endpoint
    });
    const generatedPath = join(directory, 'src', 'w3booster.generated.ts');
    assert.match(await readFile(generatedPath, 'utf8'), /@w3booster-client-id app_cli/);

    await rm(generatedPath);
    await run(process.execPath, [cli], { cwd: directory });
    assert.match(await readFile(generatedPath, 'utf8'), /@w3booster-client-id app_cli/);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('settings CLI installs lifecycle hooks only when explicitly requested', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'w3booster-settings-hooks-'));
  const server = definitionServer();
  try {
    const endpoint = await listen(server);
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      private: true,
      scripts: { dev: 'vite', predev: 'node prepare.js', 'start-ssl': 'vite --https', build: 'vite build' }
    }, null, 2));
    await run(process.execPath, [cli, 'init', 'app_cli', '--endpoint', endpoint, '--install-hooks'], { cwd: directory });
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts.predev, 'npm run w3booster:sync && node prepare.js');
    assert.equal(manifest.scripts['prestart-ssl'], 'npm run w3booster:sync');
    assert.equal(manifest.scripts.prebuild, 'npm run w3booster:sync');
    assert.equal(manifest.scripts.postinstall, 'npm run w3booster:sync');
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('ordinary development uses a checked-in binding while offline but strict checks fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'w3booster-settings-'));
  const outputPath = join(directory, 'generated.ts');
  const server = definitionServer();
  try {
    const endpoint = await listen(server);
    await run(process.execPath, ['bin/sync-settings.js', 'app_cli', '--endpoint', endpoint, '--output', outputPath]);
    await close(server);

    const fallback = await run(process.execPath, ['bin/sync-settings.js', '--endpoint', endpoint, '--output', outputPath]);
    assert.match(fallback.stderr, /Using the checked-in binding/);
    await assert.rejects(
      run(process.execPath, ['bin/sync-settings.js', '--endpoint', endpoint, '--output', outputPath, '--check']),
      /fetch failed|Unable to fetch/
    );
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

function definitionServer() {
  return createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', etag: `"${definition.revision}"` });
    response.end(JSON.stringify(definition));
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
