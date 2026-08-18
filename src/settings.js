const SETTING_TYPES = new Set(['boolean', 'text', 'number', 'select', 'country']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SETTING_PATH = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;

/** Validate the settings schema exported by a W3Booster application record. */
export function validateSettingsSchema(schema) {
  assertObject(schema, 'settings schema');
  if (schema.version !== 1) fail('version must be 1');
  if (!Array.isArray(schema.sections)) fail('sections must be an array');
  const fields = new Map();
  const sectionIds = new Set();
  for (const section of schema.sections) {
    assertObject(section, 'section');
    assertString(section.id, 'section id');
    if (sectionIds.has(section.id)) fail(`duplicate section ${section.id}`);
    sectionIds.add(section.id);
    assertString(section.title, `section ${section.id} title`);
    if (!Array.isArray(section.fields)) fail(`section ${section.id} fields must be an array`);
    const groups = new Set();
    for (const group of section.groups || []) {
      assertObject(group, `group in ${section.id}`);
      assertString(group.id, 'group id');
      if (groups.has(group.id)) fail(`duplicate group ${group.id} in ${section.id}`);
      groups.add(group.id);
      assertString(group.title, `group ${group.id} title`);
    }
    for (const field of section.fields) {
      validateField(field, section.id, groups);
      if (fields.has(field.key)) fail(`duplicate setting ${field.key}`);
      fields.set(field.key, field);
    }
  }
  for (const field of fields.values()) {
    for (const name of ['visibleWhen', 'enabledWhen']) {
      const condition = field[name];
      if (!condition) continue;
      assertObject(condition, `${field.key}.${name}`);
      const target = fields.get(condition.key);
      if (!target) fail(`${field.key}.${name} references unknown setting ${String(condition.key)}`);
      assertSettingValue(target, condition.equals, `${name} comparison`);
      if (target.type === 'select' && !target.options.some(option => sameJson(option.value, condition.equals))) {
        fail(`${field.key}.${name} does not match an option of ${condition.key}`);
      }
    }
  }
  const paths = [...fields.keys()].sort();
  for (let index = 1; index < paths.length; index += 1) {
    if (paths[index].startsWith(`${paths[index - 1]}.`)) fail(`${paths[index - 1]} conflicts with nested setting ${paths[index]}`);
  }
  assertJson(schema, 'settings schema');
  return freeze(clone(schema));
}

/** Derive the nested defaults represented by a database settings schema. */
export function settingsDefaults(schema) {
  const validated = validateSettingsSchema(schema);
  const result = {};
  for (const section of validated.sections) {
    for (const field of section.fields) {
      if (field.default !== undefined) setPath(result, field.key, clone(field.default));
    }
  }
  return freeze(result);
}

/** Recursively apply delivered partial settings over generated defaults. Arrays replace rather than merge. */
export function resolveSettings(defaults, settings = {}) {
  assertObject(defaults, 'settings defaults');
  assertObject(settings, 'delivered settings');
  assertJson(defaults, 'settings defaults');
  assertJson(settings, 'delivered settings');
  return freeze(mergeObjects(defaults, settings));
}

/** Generate a deterministic TypeScript binding from a database application definition. */
export function generateSettingsBinding(definition) {
  assertObject(definition, 'application definition');
  assertString(definition.clientId, 'clientId');
  assertString(definition.revision, 'revision');
  if (!Array.isArray(definition.scopes) || definition.scopes.some(scope => typeof scope !== 'string')) fail('scopes must be an array of strings');
  const schema = validateSettingsSchema(definition.settingsSchema || { version: 1, sections: [] });
  return [
    '/* Generated from the W3Booster application database. Do not edit directly. */',
    `// @w3booster-client-id ${definition.clientId}`,
    `// @w3booster-revision ${definition.revision}`,
    '',
    "import { connect, createClient, type ConnectOptions, type DeepReadonly, type StartupOptions } from '@w3booster/sdk';",
    "import { resolveSettings, type DeepPartial } from '@w3booster/sdk/settings';",
    '',
    `export interface W3BoosterAppSettings ${renderType(typeTree(schema))}`,
    'export type W3BoosterAppDeliveredSettings = DeepPartial<W3BoosterAppSettings>;',
    'const w3boosterEmptySettings: W3BoosterAppDeliveredSettings = {};',
    'const w3boosterResolvedSettings = new WeakMap<object, DeepReadonly<W3BoosterAppSettings>>();',
    '',
    'export const w3boosterApp = {',
    `  clientId: ${JSON.stringify(definition.clientId)},`,
    `  revision: ${JSON.stringify(definition.revision)},`,
    `  scopes: ${JSON.stringify(definition.scopes)},`,
    `  settingsDefaults: ${indentJson(settingsDefaults(schema), 2)}`,
    '} as const;',
    '',
    "export type W3BoosterAppConnectOptions = Omit<ConnectOptions<W3BoosterAppDeliveredSettings>, 'clientId' | 'scopes'> & {",
    "  readonly scopes?: readonly (typeof w3boosterApp.scopes)[number][] | 'configured';",
    '};',
    '',
    '/** Connect with this application\'s identity and generated settings type. */',
    'export function connectW3BoosterApp(options: W3BoosterAppConnectOptions = {}) {',
    '  return connect<W3BoosterAppDeliveredSettings>({ ...options, clientId: w3boosterApp.clientId });',
    '}',
    '',
    '/** Create a typed client before connecting so lifecycle listeners can be attached first. */',
    'export function createW3BoosterAppClient(options: W3BoosterAppConnectOptions = {}) {',
    '  return createClient<W3BoosterAppDeliveredSettings>({ ...options, clientId: w3boosterApp.clientId });',
    '}',
    '',
    '/** Connect and wait for the lifecycle milestone needed by a long-lived frontend. */',
    'export async function startW3BoosterApp(options: W3BoosterAppConnectOptions = {}, startup: StartupOptions = {}) {',
    '  const signal = startup.signal ?? options.signal;',
    '  const client = createW3BoosterAppClient({ ...options, signal });',
    '  try {',
    '    await client.start({ ...startup, signal });',
    '    return client;',
    '  } catch (error) {',
    '    await client.disconnect();',
    '    throw error;',
    '  }',
    '}',
    '',
    '/** Apply partial delivered values over the generated application defaults. */',
    'export function resolveW3BoosterAppSettings(settings: W3BoosterAppDeliveredSettings = w3boosterEmptySettings): DeepReadonly<W3BoosterAppSettings> {',
    '  const cached = w3boosterResolvedSettings.get(settings);',
    '  if (cached) return cached;',
    '  const resolved = resolveSettings<W3BoosterAppSettings>(w3boosterApp.settingsDefaults, settings);',
    '  w3boosterResolvedSettings.set(settings, resolved);',
    '  return resolved;',
    '}',
    ''
  ].join('\n');
}

function validateField(field, sectionId, groups) {
  assertObject(field, `field in ${sectionId}`);
  if (!SETTING_PATH.test(field.key || '') || field.key.split('.').some(key => UNSAFE_KEYS.has(key))) fail(`invalid setting key ${String(field.key)}`);
  assertString(field.label, `${field.key} label`);
  if (!SETTING_TYPES.has(field.type)) fail(`${field.key} has unknown type ${String(field.type)}`);
  if (!field.internal && (!field.group || !groups.has(field.group))) fail(`${field.key} must reference a group in ${sectionId}`);
  if (field.default !== undefined) assertSettingValue(field, field.default, 'default');
  if (field.type === 'select') {
    if (!Array.isArray(field.options) || !field.options.length) fail(`${field.key} options must not be empty`);
    for (const option of field.options) {
      assertObject(option, `${field.key} option`);
      assertString(option.label, `${field.key} option label`);
      assertJson(option.value, `${field.key} option value`);
    }
    if (field.default !== undefined && !field.options.some(option => sameJson(option.value, field.default))) fail(`${field.key} default must match an option`);
  }
}
function assertSettingValue(field, value, suffix) {
  assertJson(value, `${field.key} ${suffix}`);
  if (field.type === 'boolean' && typeof value !== 'boolean') fail(`${field.key} ${suffix} must be boolean`);
  if (field.type === 'number' && typeof value !== 'number') fail(`${field.key} ${suffix} must be a number`);
  if ((field.type === 'text' || field.type === 'country') && typeof value !== 'string') fail(`${field.key} ${suffix} must be text`);
}
function typeTree(schema) {
  const root = { children: new Map(), field: null };
  for (const section of schema.sections) for (const field of section.fields) {
    let node = root;
    for (const key of field.key.split('.')) {
      if (!node.children.has(key)) node.children.set(key, { children: new Map(), field: null });
      node = node.children.get(key);
    }
    node.field = field;
  }
  return root;
}
function renderType(node, depth = 0) {
  if (!node.children.size) return '{}';
  const indentation = '  '.repeat(depth);
  const lines = ['{'];
  for (const [key, child] of node.children) {
    const optional = child.field?.default === undefined && !hasDefault(child) ? '?' : '';
    lines.push(`${'  '.repeat(depth + 1)}${key}${optional}: ${child.field ? fieldType(child.field) : renderType(child, depth + 1)};`);
  }
  lines.push(`${indentation}}`);
  return lines.join('\n');
}
function hasDefault(node) { return node.field?.default !== undefined || [...node.children.values()].some(hasDefault); }
function fieldType(field) {
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'number') return 'number';
  if (field.type === 'text' || field.type === 'country') return 'string';
  if (field.options.every(option => typeof option.value === 'boolean')) return 'boolean';
  return field.options.map(option => JSON.stringify(option.value)).join(' | ') || 'never';
}
function assertObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`); }
function assertString(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`); }
function assertJson(value, label, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || seen.has(value)) fail(`${label} must be finite, acyclic JSON`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertJson(item, `${label}[${index}]`, seen));
  else for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key) || item === undefined) fail(`${label}.${key} is not JSON-compatible`);
    assertJson(item, `${label}.${key}`, seen);
  }
  seen.delete(value);
}
function setPath(target, path, value) { const keys = path.split('.'); let node = target; for (const key of keys.slice(0, -1)) node = node[key] ||= {}; node[keys.at(-1)] = value; }
function mergeObjects(defaults, settings) {
  const result = {};
  for (const [key, value] of Object.entries(defaults)) {
    result[key] = isMergeableObject(value) ? mergeObjects(value, {}) : clone(value);
  }
  for (const [key, value] of Object.entries(settings)) {
    result[key] = isMergeableObject(value) && isMergeableObject(defaults[key])
      ? mergeObjects(defaults[key], value)
      : clone(value);
  }
  return result;
}
function isMergeableObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function indentJson(value, spaces) { return JSON.stringify(value, null, 2).replace(/\n/g, `\n${' '.repeat(spaces)}`); }
function clone(value) { return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function fail(message) { throw new TypeError(`Invalid W3Booster settings definition: ${message}.`); }
