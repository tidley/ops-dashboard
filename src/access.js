const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i;
const ACCESS_ROLES = new Set(['admin', 'operator', 'viewer']);
const ACCESS_SCOPES = new Set(['dashboard']);

function normalizeHexPubkey(pubkey) {
  const value = `${pubkey || ''}`.trim().toLowerCase();
  return HEX_PUBKEY_RE.test(value) ? value : '';
}

function normalizeAccessRole(role) {
  const value = `${role || ''}`.trim().toLowerCase();
  return ACCESS_ROLES.has(value) ? value : 'viewer';
}

function normalizeAccessScope(scope) {
  const value = `${scope || ''}`.trim().toLowerCase();
  if (!value) return 'dashboard';
  if (ACCESS_SCOPES.has(value)) return value;
  return value;
}

function parseAccessTimestamp(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isTimestampFresh(issuedAt, expiresAt, nowMs = Date.now()) {
  const issued = parseAccessTimestamp(issuedAt);
  const expiry = parseAccessTimestamp(expiresAt);
  if (!issued || !expiry) return false;
  if (issued > nowMs) return false;
  return nowMs <= expiry;
}

module.exports = {
  ACCESS_ROLES,
  ACCESS_SCOPES,
  isTimestampFresh,
  normalizeAccessRole,
  normalizeAccessScope,
  normalizeHexPubkey,
  parseAccessTimestamp,
};
