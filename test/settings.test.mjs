import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSettingsBinding, resolveSettings, settingsDefaults, validateSettingsSchema } from '../src/settings.js';

const schema = {
  version: 1,
  sections: [{
    id: 'display', title: 'Display', groups: [{ id: 'layout', title: 'Layout' }],
    fields: [
      { key: 'display.enabled', label: 'Enabled', type: 'boolean', default: true, group: 'layout' },
      { key: 'display.position', label: 'Position', type: 'select', default: 'left', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], enabledWhen: { key: 'display.enabled', equals: true }, group: 'layout' }
    ]
  }]
};

test('database settings schemas validate and produce immutable defaults', () => {
  const validated = validateSettingsSchema(schema);
  assert.equal(Object.isFrozen(validated.sections[0].fields), true);
  assert.deepEqual(settingsDefaults(validated), { display: { enabled: true, position: 'left' } });
});

test('partial delivered settings recursively resolve over immutable defaults', () => {
  const resolved = resolveSettings(
    { display: { enabled: true, labels: { primary: 'Player', secondary: 'Opponent' } }, slots: ['first'] },
    { display: { labels: { primary: 'Caster' } }, slots: ['replacement'] }
  );
  assert.deepEqual(resolved, {
    display: { enabled: true, labels: { primary: 'Caster', secondary: 'Opponent' } },
    slots: ['replacement']
  });
  assert.equal(Object.isFrozen(resolved.display.labels), true);
  assert.equal(Object.isFrozen(resolved.slots), true);
});

test('settings reject non-JSON object instances instead of silently erasing them', () => {
  assert.throws(() => resolveSettings({ value: new Date() }), /plain JSON object/);
  assert.throws(() => resolveSettings({ value: new Map([['key', 'value']]) }), /plain JSON object/);
  assert.throws(() => resolveSettings({}, Object.create({ inherited: true })), /plain object/);
});

test('database settings validation rejects drift and unsafe paths', () => {
  const missing = structuredClone(schema);
  missing.sections[0].fields[1].enabledWhen.key = 'display.missing';
  assert.throws(() => validateSettingsSchema(missing), /unknown setting/);
  const conflicting = structuredClone(schema);
  conflicting.sections[0].fields.push({ key: 'display', label: 'Display', type: 'boolean', default: true, group: 'layout' });
  assert.throws(() => validateSettingsSchema(conflicting), /conflicts with nested setting/);
});

test('database definitions generate deterministic typed frontend bindings', () => {
  assert.throws(
    () => generateSettingsBinding({ clientId: 'app_test', revision: 'revision-1', scopes: ['unknown:read'], settingsSchema: schema }),
    /known W3Booster scopes/
  );
  const binding = generateSettingsBinding({ clientId: 'app_test', revision: 'revision-1', scopes: ['match:read'], settingsSchema: schema });
  assert.match(binding, /export interface W3BoosterAppSettings/);
  assert.match(binding, /position: "left" \| "right"/);
  assert.match(binding, /clientId: "app_test"/);
  assert.match(binding, /revision: "revision-1"/);
  assert.match(binding, /defineApplication</);
  assert.match(binding, /W3BoosterAppDeliveredSettings = DeepPartial<W3BoosterAppSettings>/);
  assert.match(binding, /W3BoosterAppClient<TOverlayExtensions extends object = object> = W3BoosterClient<W3BoosterAppDeliveredSettings, TOverlayExtensions>/);
  assert.match(binding, /W3BoosterAppRuntime<TOverlayExtensions extends object = object> = ApplicationRuntime<W3BoosterAppSettings, TOverlayExtensions>/);
  assert.match(binding, /W3BoosterAppRuntimeSnapshot<TOverlayExtensions extends object = object> = ApplicationRuntimeSnapshot<W3BoosterAppSettings, TOverlayExtensions>/);
  assert.match(binding, /W3BoosterAppConnectOptions<TOverlayExtensions extends object = object> = ApplicationConnectOptions<[\s\S]*TOverlayExtensions/);
  assert.match(binding, /export const w3boosterApp = defineApplication/);
  assert.doesNotMatch(binding, /WeakMap|client\.start|client\.disconnect|connectW3BoosterApp/);
});
