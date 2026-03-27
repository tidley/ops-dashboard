const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateSecretKey, getPublicKey } = require('nostr-tools');

describe('nip17 access auth', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let store;
  let auth;
  let gateway;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-nip17-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/access')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/nostr-auth')];
    delete require.cache[require.resolve('../src/webrtc-gateway')];

    const db = require('../src/db');
    db.initDb();
    store = require('../src/store');
    auth = require('../src/nostr-auth');
    gateway = require('../src/webrtc-gateway');
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('accepts a signed NIP-17 bootstrap only for allowlisted pubkeys', function() {
    const gatewayIdentity = auth.loadGatewayIdentity();
    const requesterSk = generateSecretKey();
    const requesterPubkey = getPublicKey(requesterSk);

    store.upsertAccessPrincipal({
      pubkey: requesterPubkey,
      label: 'Allowed user',
      role: 'operator',
      scope: 'dashboard',
    });

    const event = auth.createBootstrapRequestEvent({
      requesterSk,
      gatewayPubkey: gatewayIdentity.pubkey,
      sessionId: 'acc-bootstrap-test',
      nonce: 'nonce-bootstrap-test',
      extra: {
        project_id: 'proj-allowed',
      },
    });

    const result = auth.handleBootstrapEvent({
      event,
      gatewayIdentity,
      metadata: { source: 'test' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.session.id, 'acc-bootstrap-test');
    assert.equal(result.session.pubkey, requesterPubkey);
    assert.equal(result.session.metadata_json.gateway_pubkey, gatewayIdentity.pubkey);
    assert.equal(result.signal_url, '/api/access/sessions/acc-bootstrap-test/signal');
    assert.equal(result.proxy_url, '/api/access/sessions/acc-bootstrap-test/proxy');

    const session = store.getAccessSession('acc-bootstrap-test');
    assert.equal(session.state, 'active');
    assert.equal(session.metadata_json.request_type, 'bootstrap_request');
  });

  it('accepts a fresh bootstrap request even if the client expiry is already behind', function() {
    const gatewayIdentity = auth.loadGatewayIdentity();
    const requesterSk = generateSecretKey();
    const requesterPubkey = getPublicKey(requesterSk);

    store.upsertAccessPrincipal({
      pubkey: requesterPubkey,
      label: 'Clock skew user',
      role: 'operator',
      scope: 'dashboard',
    });

    const issuedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const staleExpiresAt = new Date(Date.now() - 1000).toISOString();
    const event = auth.createBootstrapRequestEvent({
      requesterSk,
      gatewayPubkey: gatewayIdentity.pubkey,
      sessionId: 'acc-bootstrap-clock-skew',
      nonce: 'nonce-bootstrap-clock-skew',
      extra: {
        issued_at: issuedAt,
        expires_at: staleExpiresAt,
      },
    });

    const result = auth.handleBootstrapEvent({
      event,
      gatewayIdentity,
      metadata: { source: 'test' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.session.id, 'acc-bootstrap-clock-skew');
    assert.equal(result.session.pubkey, requesterPubkey);
    assert.equal(result.session.metadata_json.bootstrap_requested_expires_at, staleExpiresAt);
    assert.ok(new Date(result.session.expires_at).getTime() > Date.now());
  });

  it('rejects bootstrap requests from unallowlisted pubkeys', function() {
    const gatewayIdentity = auth.loadGatewayIdentity();
    const requesterSk = generateSecretKey();

    const event = auth.createBootstrapRequestEvent({
      requesterSk,
      gatewayPubkey: gatewayIdentity.pubkey,
      sessionId: 'acc-reject-test',
      nonce: 'nonce-reject-test',
    });

    const result = auth.handleBootstrapEvent({
      event,
      gatewayIdentity,
      metadata: { source: 'test' },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'pubkey_not_allowed');
  });

  it('rejects bootstrap requests that are too stale', function() {
    const gatewayIdentity = auth.loadGatewayIdentity();
    const requesterSk = generateSecretKey();
    const requesterPubkey = getPublicKey(requesterSk);

    store.upsertAccessPrincipal({
      pubkey: requesterPubkey,
      label: 'Stale user',
      role: 'operator',
      scope: 'dashboard',
    });

    const issuedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const event = auth.createBootstrapRequestEvent({
      requesterSk,
      gatewayPubkey: gatewayIdentity.pubkey,
      sessionId: 'acc-bootstrap-stale',
      nonce: 'nonce-bootstrap-stale',
      extra: {
        issued_at: issuedAt,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    });

    const result = auth.handleBootstrapEvent({
      event,
      gatewayIdentity,
      metadata: { source: 'test' },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'stale');
  });

  it('proxies an HTTP request once a session exists', async function() {
    const previousFetch = global.fetch;

    try {
      global.fetch = async (url, options) => {
        assert.equal(String(url), 'http://proxy.local/hello');
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.get('accept'), 'application/json');
        assert.equal(options.headers.get('cookie'), 'ops_access_session=acc-proxy-test');
        assert.equal(options.headers.get('x-access-session'), 'acc-proxy-test');
        return {
          ok: true,
          status: 200,
          headers: {
            forEach(callback) {
              callback('application/json', 'content-type');
            },
          },
          async text() {
            return JSON.stringify({ path: '/hello', method: 'GET' });
          },
        };
      };

      const requesterSk = generateSecretKey();
      const requesterPubkey = getPublicKey(requesterSk);
      store.upsertAccessPrincipal({
        pubkey: requesterPubkey,
        label: 'Proxy user',
        role: 'viewer',
        scope: 'dashboard',
      });

      const session = store.issueAccessSession({
        pubkey: requesterPubkey,
        scope: 'dashboard',
        session_id: 'acc-proxy-test',
        nonce: 'nonce-proxy-test',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

      const gw = new gateway.WebRtcGateway({
        store,
        baseUrl: 'http://proxy.local',
        iceServers: [],
      });

      const ensure = gw.ensureSession(session.id);
      assert.equal(ensure.ok, true);

      const response = await gw.proxyHttpRequest(session.id, {
        request_id: 'req-1',
        method: 'GET',
        path: '/hello',
        headers: { accept: 'application/json' },
      });

      assert.equal(response.type, 'http_response');
      assert.equal(response.request_id, 'req-1');
      assert.equal(response.response.status, 200);
      assert.ok(response.response.body.includes('"path":"/hello"'));
      assert.ok(response.response.body.includes('"method":"GET"'));
    } finally {
      global.fetch = previousFetch;
    }
  });
});
