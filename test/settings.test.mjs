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

test('database settings validation rejects drift and unsafe paths', () => {
  const missing = structuredClone(schema);
  missing.sections[0].fields[1].enabledWhen.key = 'display.missing';
  assert.throws(() => validateSettingsSchema(missing), /unknown setting/);
  const conflicting = structuredClone(schema);
  conflicting.sections[0].fields.push({ key: 'display', label: 'Display', type: 'boolean', default: true, group: 'layout' });
  assert.throws(() => validateSettingsSchema(conflicting), /conflicts with nested setting/);
});

test('database definitions generate deterministic typed frontend bindings', () => {
  const binding = generateSettingsBinding({ clientId: 'app_test', revision: 'revision-1', scopes: ['match:read'], settingsSchema: schema });
  assert.match(binding, /export interface W3BoosterAppSettings/);
  assert.match(binding, /position: "left" \| "right"/);
  assert.match(binding, /clientId: "app_test"/);
  assert.match(binding, /revision: "revision-1"/);
  assert.match(binding, /function connectW3BoosterApp/);
  assert.match(binding, /W3BoosterAppDeliveredSettings = DeepPartial<W3BoosterAppSettings>/);
  assert.match(binding, /connect<W3BoosterAppDeliveredSettings>/);
  assert.match(binding, /function createW3BoosterAppClient/);
  assert.match(binding, /createClient<W3BoosterAppDeliveredSettings>/);
  assert.match(binding, /function startW3BoosterApp/);
  assert.match(binding, /createW3BoosterAppClient\(\{ \.\.\.options, signal \}\)/);
  assert.match(binding, /await client\.disconnect\(\)/);
  assert.match(binding, /w3boosterResolvedSettings = new WeakMap/);
  assert.match(binding, /function resolveW3BoosterAppSettings\(settings: W3BoosterAppDeliveredSettings = w3boosterEmptySettings\): DeepReadonly<W3BoosterAppSettings>/);
});
