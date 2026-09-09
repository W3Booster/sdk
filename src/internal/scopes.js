const KNOWN_SCOPES = new Set([
  'match:read',
  'players:read',
  'stats:read',
  'heroes:read',
  'units:read',
  'buildings:read',
  'production:read',
  'upgrades:read',
  'resources:read',
  'controlgroups:read'
]);

export function isKnownScope(value) {
  return typeof value === 'string' && KNOWN_SCOPES.has(value);
}
