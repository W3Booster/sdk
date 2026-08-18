import test from 'node:test';
import assert from 'node:assert/strict';
import * as assets from '../src/assets.js';

test('asset helpers resolve country codes against the versioned public catalog', () => {
  assert.equal(assets.countryFlagFileName(' DE '), 'de.png');
  assert.equal(assets.countryFlagUrl('DE'), 'https://static.w3booster.com/assets/country-flags/v1/flags/de.png');
  assert.equal(
    assets.countryFlagUrl('GB-ENG', { baseUrl: 'http://localhost:8083/assets/' }),
    'http://localhost:8083/assets/country-flags/v1/flags/gb-eng.png'
  );
  assert.equal(assets.countryFlagUrl('../secret'), undefined);
  assert.equal(assets.countryFlagManifestUrl(), 'https://static.w3booster.com/assets/country-flags/v1/manifest.json');
});

test('asset helpers consume a validated platform-advertised local asset origin', () => {
  assert.equal(
    assets.resolveAssetBaseUrl({ location: { search: '?backend=local&assetBaseUrl=http%3A%2F%2Flocalhost%3A8083%2Fassets' } }),
    'http://localhost:8083/assets'
  );
  assert.equal(assets.resolveAssetBaseUrl({ location: { search: '?backend=local' } }), assets.assetBaseUrl);
  assert.equal(assets.resolveAssetBaseUrl({ location: { search: '?assetBaseUrl=http%3A%2F%2Fevil.example' } }), assets.assetBaseUrl);
  assert.equal(assets.resolveAssetBaseUrl({ location: { search: '?assetBaseUrl=https%3A%2F%2Fevil.example' } }), assets.assetBaseUrl);
  assert.equal(
    assets.resolveAssetBaseUrl({ location: { search: '?backend=local&assetBaseUrl=https%3A%2F%2Fevil.example' } }),
    assets.assetBaseUrl
  );
  assert.equal(assets.resolveAssetBaseUrl({ baseUrl: 'http://[::1]:8083/' }), 'http://[::1]:8083');
  assert.throws(() => assets.normalizeAssetBaseUrl('http://example.com'), /must use HTTPS/);
  assert.throws(() => assets.normalizeAssetBaseUrl('https://user@example.com'), /credentials/);
});
