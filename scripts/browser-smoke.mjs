import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repository = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const html = `<!doctype html>
<html><body data-result="pending"><script type="module">
  import { connect, createClient } from '/src/index.js';
  try {
    const unrelated = createClient({ clientId: 'browser_review' });
    if (unrelated.host.available) throw new Error('unrelated top-level page was treated as a host');

    const lifetime = new AbortController();
    const client = await connect({ clientId: 'browser_review', demo: true, signal: lifetime.signal });
    const state = await client.whenReady({ signal: lifetime.signal });
    if (state.match.id !== 'demo-match') throw new Error('demo state was not hydrated');

    if (typeof client.events.emit !== 'undefined') throw new Error('internal event mutation leaked through the public facade');

    lifetime.abort();
    await new Promise(resolve => setTimeout(resolve));
    if (client.status !== 'closed') throw new Error('lifetime abort did not disconnect');
    document.body.dataset.result = 'pass';
    document.body.textContent = 'W3Booster SDK browser smoke passed';
  } catch (error) {
    document.body.dataset.result = 'fail';
    document.body.textContent = error?.stack || String(error);
  }
</script></body></html>`;

const chrome = await findChrome();
const profile = await mkdtemp(join(tmpdir(), 'w3booster-sdk-chrome-'));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(html);
      return;
    }
    const path = normalize(join(repository, pathname));
    if (!path.startsWith(`${repository}/`)) throw new Error('invalid path');
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': extname(path) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(body);
  } catch (_) {
    response.writeHead(404);
    response.end('not found');
  }
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const { stdout } = await run(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=2000',
    '--dump-dom',
    `http://127.0.0.1:${address.port}/`
  ], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  if (!stdout.includes('data-result="pass"')) {
    throw new Error(`Browser smoke test failed:\n${stdout}`);
  }
  console.log('W3Booster SDK browser smoke passed.');
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

async function findChrome() {
  const executableNames = ['google-chrome-stable', 'google-chrome', 'chrome', 'chromium'];
  const pathCandidates = (process.env.PATH || '').split(':')
    .flatMap(directory => executableNames.map(name => join(directory, name)));
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    ...pathCandidates
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; }
    catch (_) { /* Try the next installed browser. */ }
  }
  throw new Error('Chrome or Chromium is required for npm run test:browser. Set CHROME_BIN when it is installed elsewhere.');
}
