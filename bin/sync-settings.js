#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { generateSettingsBinding } from '../src/settings.js';

const values = process.argv.slice(2);
const defaultOutput = 'src/w3booster.generated.ts';
const usage = [
  'Usage:',
  '  w3booster-settings init <clientId> [--output <file>]',
  '      [--endpoint <url>] [--install-hooks]',
  '  w3booster-settings [clientId] [--output <file>] [--check]',
  '',
  `The default output is ${defaultOutput}.`,
  'Outputs ending in .js, .mjs, or .jsx are generated as plain ESM; other outputs use TypeScript.',
  'init binds the project and adds explicit sync/check scripts.',
  '--install-hooks additionally wires synchronization into install/dev/start/build.',
  'W3BOOSTER_SETTINGS_URL can select the endpoint in connected CI.',
  'Later runs read clientId and output from package.json or the generated file.'
].join('\n');

try {
  const arguments_ = parseArguments(values);
  if (arguments_.help) {
    console.log(usage);
  } else if (arguments_.initialize) {
    await initializeProject(arguments_);
  } else {
    await synchronize(arguments_);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function initializeProject(arguments_) {
  if (arguments_.check) throw new TypeError('--check cannot be used with init.');
  if (!arguments_.requestedClientId) throw new TypeError(`clientId is required for initialization.\n\n${usage}`);
  const packagePath = resolve('package.json');
  const packageSource = await readFile(packagePath, 'utf8').catch(() => '');
  if (!packageSource) throw new Error('Run init from a project containing package.json.');
  let manifest;
  try {
    manifest = JSON.parse(packageSource);
  } catch {
    throw new Error('package.json is not valid JSON.');
  }
  await synchronize(arguments_);

  if (manifest.scripts !== undefined
    && (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))) {
    throw new TypeError('package.json scripts must be an object.');
  }
  const scripts = manifest.scripts ||= {};
  const output = arguments_.output || defaultOutput;
  const outputArgument = output === defaultOutput
    ? ''
    : ` --output ${JSON.stringify(output)}`;
  const syncCommand = `w3booster-settings${outputArgument}`;
  manifest.w3booster = {
    ...(manifest.w3booster && typeof manifest.w3booster === 'object' && !Array.isArray(manifest.w3booster)
      ? manifest.w3booster
      : {}),
    clientId: arguments_.requestedClientId,
    settingsOutput: output,
    ...(arguments_.endpoint ? { endpoint: arguments_.endpoint } : {})
  };
  scripts['w3booster:sync'] = syncCommand;
  scripts['w3booster:check'] = `${syncCommand} --check`;
  if (arguments_.installHooks) {
    addLifecycleScript('postinstall');
    for (const lifecycle of Object.keys(scripts)) {
      if (!/^(?:dev|start|build)(?:$|[-:_])/.test(lifecycle)) continue;
      addLifecycleScript(`pre${lifecycle}`);
    }
  }

  if (JSON.stringify(manifest) !== JSON.stringify(JSON.parse(packageSource))) {
    const indentation = packageSource.match(/\n([ \t]+)"/)?.[1] || '  ';
    await writeFile(packagePath, `${JSON.stringify(manifest, null, indentation)}\n`, 'utf8');
    console.log(arguments_.installHooks
      ? 'Bound this project and enabled automatic W3Booster settings synchronization.'
      : 'Bound this project and added W3Booster settings sync/check scripts.');
  }

  function addLifecycleScript(name) {
    // Package lifecycle scripts already receive node_modules/.bin on PATH, so
    // invoke the SDK CLI directly instead of assuming npm/pnpm/yarn/bun.
    const automaticCommand = 'w3booster-settings';
    const current = typeof scripts[name] === 'string' ? scripts[name].trim() : '';
    if (current.includes(automaticCommand)) return;
    scripts[name] = current ? `${automaticCommand} && ${current}` : automaticCommand;
  }
}

async function synchronize({ requestedClientId, output: requestedOutput, check, endpoint: requestedEndpoint }) {
  const configured = await projectConfiguration();
  const endpoint = requestedEndpoint || configured.endpoint || process.env.W3BOOSTER_SETTINGS_URL;
  const output = requestedOutput || configured.settingsOutput || defaultOutput;
  const outputPath = resolve(output);
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  const metadata = generatedMetadata(current);
  const clientId = requestedClientId || configured.clientId || metadata.clientId;
  if (!clientId) throw new TypeError(`clientId is required for the first generation.\n\n${usage}`);
  const knownClientId = configured.clientId || metadata.clientId;
  if (requestedClientId && knownClientId && requestedClientId !== knownClientId) {
    throw new Error(`The existing project binding belongs to ${knownClientId}, not ${requestedClientId}.`);
  }

  let result;
  try {
    result = await fetchDefinition(clientId, endpoint);
  } catch (error) {
    if (!check && metadata.clientId === clientId) {
      console.warn(`Could not refresh W3Booster settings (${error instanceof Error ? error.message : String(error)}). Using the checked-in binding at revision ${metadata.revision || 'unknown'}.`);
      return;
    }
    throw error;
  }

  const definition = result;
  if (definition.clientId !== clientId) throw new Error(`Application definition belongs to ${definition.clientId}, not ${clientId}.`);
  const extension = extname(outputPath).toLowerCase();
  const format = ['.js', '.mjs', '.jsx'].includes(extension) ? 'javascript' : 'typescript';
  const binding = generateSettingsBinding(definition, { format });
  if (check) {
    if (current !== binding) throw new Error(`Generated W3Booster settings are stale: ${outputPath}`);
    console.log(`W3Booster settings are current at revision ${definition.revision}.`);
    return;
  }
  if (current === binding) {
    console.log(`W3Booster settings are current at revision ${definition.revision}.`);
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, binding, 'utf8');
  console.log(`Generated W3Booster settings at revision ${definition.revision}: ${outputPath}`);
}

function parseArguments(args) {
  args = [...args];
  const initialize = args[0] === 'init';
  if (initialize) args.shift();
  const options = new Map();
  const flags = new Set();
  const positionals = [];
  const valueOptions = new Set(['--output', '--endpoint']);
  const flagOptions = new Set(['--check', '--help', '--install-hooks']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (valueOptions.has(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new TypeError(`${argument} requires a value.`);
      if (options.has(argument)) throw new TypeError(`${argument} may only be specified once.`);
      options.set(argument, value);
    } else if (flagOptions.has(argument)) {
      flags.add(argument);
    } else if (argument.startsWith('--')) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else {
      positionals.push(argument);
    }
  }
  if (positionals.length > 1) throw new TypeError(`Expected at most one clientId.\n\n${usage}`);
  if (!initialize && flags.has('--install-hooks')) throw new TypeError('--install-hooks can only be used with init.');
  return {
    requestedClientId: positionals[0],
    output: options.get('--output'),
    endpoint: options.get('--endpoint'),
    check: flags.has('--check'),
    help: flags.has('--help'),
    installHooks: flags.has('--install-hooks'),
    initialize
  };
}

async function projectConfiguration() {
  let source;
  try {
    source = await readFile(resolve('package.json'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error('package.json is not valid JSON.');
  }
  const configuration = manifest?.w3booster;
  return configuration && typeof configuration === 'object' && !Array.isArray(configuration)
    ? configuration
    : {};
}

function generatedMetadata(source) {
  if (!source.startsWith('/* Generated from the W3Booster application database. Do not edit directly. */')) return {};
  const clientId = source.match(/^\/\/ @w3booster-client-id (\S+)$/m)?.[1]
    || JSON.parse(source.match(/^\s*clientId: ("(?:[^"\\]|\\.)*"),$/m)?.[1] || 'null');
  const revision = source.match(/^\/\/ @w3booster-revision (\S+)$/m)?.[1]
    || JSON.parse(source.match(/^\s*revision: ("(?:[^"\\]|\\.)*"),$/m)?.[1] || 'null');
  return { clientId: clientId || undefined, revision: revision || undefined };
}

async function fetchDefinition(clientId, endpoint) {
  const baseUrl = String(endpoint || 'https://app.w3booster.com').replace(/\/$/, '');
  const headers = { accept: 'application/json' };
  const response = await fetch(`${baseUrl}/stream/v1/app-definitions/${encodeURIComponent(clientId)}`, { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Unable to fetch application settings (${response.status}).`);
  }
  return response.json();
}
