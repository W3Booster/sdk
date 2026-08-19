import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

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
  const url = `http://127.0.0.1:${address.port}/`;
  for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
    let browser;
    try {
      browser = await browserType.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url);
      await page.waitForFunction(() => document.body.dataset.result !== 'pending', null, { timeout: 20000 });
      const result = await page.locator('body').getAttribute('data-result');
      const output = await page.locator('body').innerText();
      if (result !== 'pass') throw new Error(`${name} browser smoke failed:\n${output}`);
      console.log(`W3Booster SDK ${name} smoke passed.`);
    } catch (error) {
      if (error instanceof Error && /Executable doesn't exist|browserType\.launch/.test(String(error))) {
        error.message += '\nInstall test engines with: npx playwright install chromium firefox webkit';
      }
      throw error;
    } finally {
      await browser?.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
