const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  nip17,
  nip19,
  validateEvent,
  verifyEvent,
} = require('nostr-tools');
const { DATA_DIR } = require('./db');
const { normalizeHexPubkey } = require('./access');
const {
  isAccessAllowed,
  hasAccessReplay,
  recordAccessEvent,
  rememberAccessReplay,
  issueAccessSession,
  getAccessSession,
  touchAccessSession,
} = require('./store');

const ACCESS_APP = 'ops-dashboard.access.v1';
const GATEWAY_IDENTITY_PATH = path.join(DATA_DIR, 'access-gateway.json');
const DEFAULT_ACCESS_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_BOOTSTRAP_AGE_MS = 30 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function generateSessionToken() {
  if (typeof crypto.randomBytes === 'function') {
    return crypto.randomBytes(16).toString('hex');
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadSecretKeyFromInput(input) {
  const raw = `${input || ''}`.trim();
  if (!raw) return null;

  try {
    const decoded = nip19.decode(raw);
    if (decoded.type === 'nsec') return decoded.data;
  } catch {
    // ignore
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  return null;
}

function persistGatewayIdentity(nsec) {
  fs.mkdirSync(path.dirname(GATEWAY_IDENTITY_PATH), { recursive: true });
  fs.writeFileSync(GATEWAY_IDENTITY_PATH, JSON.stringify({ nsec }, null, 2));
}

function loadGatewayIdentity() {
  const envKey = loadSecretKeyFromInput(process.env.ACCESS_NSEC || process.env.NOSTR_NSEC || process.env.DASHBOARD_NSEC);
  if (envKey) {
    return {
      sk: envKey,
      pubkey: getPublicKey(envKey),
      npub: nip19.npubEncode(getPublicKey(envKey)),
      source: 'env',
    };
  }

  if (fs.existsSync(GATEWAY_IDENTITY_PATH)) {
    const file = parseJson(fs.readFileSync(GATEWAY_IDENTITY_PATH, 'utf8'), {});
    const fileKey = loadSecretKeyFromInput(file.nsec);
    if (fileKey) {
      return {
        sk: fileKey,
        pubkey: getPublicKey(fileKey),
        npub: nip19.npubEncode(getPublicKey(fileKey)),
        source: 'file',
      };
    }
  }

  const sk = generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  persistGatewayIdentity(nsec);

  return {
    sk,
    pubkey: getPublicKey(sk),
    npub: nip19.npubEncode(getPublicKey(sk)),
    source: 'generated',
  };
}

function normalizeBootstrapPayload(input = {}) {
  const payload = parseJson(input.content || input.payload || input.message || input.body, input);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'invalid_payload' };
  }

  if (payload.app !== ACCESS_APP) {
    return { ok: false, error: 'invalid_app' };
  }

  const pubkey = normalizeHexPubkey(payload.pubkey || input.pubkey || input.sender_pubkey || '');
  if (!pubkey) {
    return { ok: false, error: 'invalid_pubkey' };
  }

  const sessionId = `${payload.session_id || input.session_id || `acc-${payload.nonce || ''}`}`.trim();
  const nonce = `${payload.nonce || input.nonce || ''}`.trim();
  const issuedAt = new Date(payload.issued_at || input.issued_at || 0).getTime();
  const expiresAt = new Date(payload.expires_at || input.expires_at || 0).getTime();
  const scope = `${payload.scope || input.scope || 'dashboard'}`.trim() || 'dashboard';

  if (!sessionId) return { ok: false, error: 'missing_session_id' };
  if (!nonce) return { ok: false, error: 'missing_nonce' };
  if (!issuedAt || !expiresAt) return { ok: false, error: 'invalid_access_window' };
  if (issuedAt > Date.now() + MAX_CLOCK_SKEW_MS) return { ok: false, error: 'issued_in_future' };
  if (Date.now() - issuedAt > MAX_BOOTSTRAP_AGE_MS) return { ok: false, error: 'stale' };

  return {
    ok: true,
    payload: {
      ...payload,
      pubkey,
      session_id: sessionId,
      nonce,
      scope,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
    },
  };
}

function createBootstrapRequestEvent({ requesterSk, gatewayPubkey, sessionId, nonce, scope = 'dashboard', ttlMs = DEFAULT_ACCESS_TTL_MS, extra = {} }) {
  const issuedAt = Date.now();
  const payload = {
    app: ACCESS_APP,
    type: 'bootstrap_request',
    pubkey: getPublicKey(requesterSk),
    session_id: sessionId || `acc-${nonce || `${issuedAt}`}`,
    nonce: nonce || `${issuedAt}-${Math.random().toString(16).slice(2)}`,
    scope,
    issued_at: new Date(issuedAt).toISOString(),
    expires_at: new Date(issuedAt + ttlMs).toISOString(),
    ...extra,
  };

  return nip17.wrapEvent(
    requesterSk,
    { publicKey: gatewayPubkey },
    JSON.stringify(payload),
  );
}

function unwrapBootstrapEvent(event, gatewaySk) {
  const rumor = nip17.unwrapEvent(event, gatewaySk);
  const payload = normalizeBootstrapPayload({
    ...parseJson(rumor.content, {}),
    sender_pubkey: rumor.pubkey,
  });

  if (!payload.ok) {
    return { ok: false, error: payload.error };
  }

  return {
    ok: true,
    event,
    senderPubkey: rumor.pubkey,
    payload: payload.payload,
    envelope: 'nip17',
  };
}

function validateSignedBootstrapEvent(event) {
  if (!event || typeof event !== 'object') return { ok: false, error: 'invalid_event' };
  if (!validateEvent(event) || !verifyEvent(event)) {
    return { ok: false, error: 'invalid_signature' };
  }
  return { ok: true };
}

function handleBootstrapEvent({ event, gatewayIdentity = loadGatewayIdentity(), metadata = {} }) {
  const signed = validateSignedBootstrapEvent(event);
  if (!signed.ok) return signed;

  let unwrapped;
  try {
    unwrapped = unwrapBootstrapEvent(event, gatewayIdentity.sk);
  } catch (err) {
    const plain = normalizeBootstrapPayload({
      ...parseJson(event.content, {}),
      sender_pubkey: event.pubkey,
    });
    if (!plain.ok) {
      return { ok: false, error: `unwrap_failed:${String(err.message || err)}` };
    }
    unwrapped = {
      ok: true,
      event,
      senderPubkey: event.pubkey,
      payload: plain.payload,
      envelope: 'plain',
    };
  }

  if (!unwrapped.ok) return unwrapped;

  const { senderPubkey, payload } = unwrapped;
  if (payload.pubkey !== senderPubkey) {
    return { ok: false, error: 'pubkey_mismatch' };
  }
  if (!isAccessAllowed(senderPubkey)) {
    recordAccessEvent({
      session_id: payload.session_id,
      pubkey: senderPubkey,
      event_type: 'bootstrap_reject',
      detail: 'pubkey_not_allowed',
    });
    return { ok: false, error: 'pubkey_not_allowed' };
  }

  if (hasAccessReplay({ session_id: payload.session_id, pubkey: senderPubkey, nonce: payload.nonce })) {
    recordAccessEvent({
      session_id: payload.session_id,
      pubkey: senderPubkey,
      event_type: 'bootstrap_replay',
      detail: payload.nonce,
    });
    return { ok: false, error: 'replay_detected' };
  }

  rememberAccessReplay({ session_id: payload.session_id, pubkey: senderPubkey, nonce: payload.nonce });

  const sessionExpiresAt = new Date(Date.now() + DEFAULT_ACCESS_TTL_MS).toISOString();
  const bootstrapCookieToken = generateSessionToken();

  const session = issueAccessSession({
    pubkey: senderPubkey,
    scope: payload.scope,
    session_id: payload.session_id,
    nonce: payload.nonce,
    issued_at: payload.issued_at,
    expires_at: sessionExpiresAt,
    metadata: {
      ...metadata,
      request_type: payload.type,
      gateway_pubkey: gatewayIdentity.pubkey,
      signal_envelope: unwrapped.envelope || metadata.signal_envelope || 'nip17',
      signal_url: `/api/access/sessions/${payload.session_id}/signal`,
      browser_proxy_url: `/api/access/sessions/${payload.session_id}/proxy`,
      bootstrap_requested_expires_at: payload.expires_at,
      bootstrap_server_expires_at: sessionExpiresAt,
      bootstrap_issued_at: payload.issued_at,
      bootstrap_cookie_token: bootstrapCookieToken,
    },
  });

  touchAccessSession(session.id, {
    state: 'active',
    last_seen_at: nowIso(),
    metadata: {
      ...(session.metadata_json || {}),
      gateway_pubkey: gatewayIdentity.pubkey,
    },
  });

  recordAccessEvent({
    session_id: session.id,
    pubkey: senderPubkey,
    event_type: 'bootstrap_accept',
    detail: payload.scope,
  });

  return {
    ok: true,
    gateway_pubkey: gatewayIdentity.pubkey,
    gateway_npub: gatewayIdentity.npub,
    session: getAccessSession(session.id),
    signal_url: `/api/access/sessions/${session.id}/signal`,
    proxy_url: `/api/access/sessions/${session.id}/proxy`,
    bootstrap_cookie_token: bootstrapCookieToken,
  };
}

module.exports = {
  ACCESS_APP,
  DEFAULT_ACCESS_TTL_MS,
  createBootstrapRequestEvent,
  handleBootstrapEvent,
  loadGatewayIdentity,
  normalizeBootstrapPayload,
  unwrapBootstrapEvent,
  validateSignedBootstrapEvent,
};
