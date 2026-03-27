const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { generateSecretKey, getPublicKey } = require('nostr-tools');

describe('access confirmation route', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let app;
  let store;
  let auth;
  let server;
  let baseUrl;

  before(async function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-access-confirm-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/access')];
    delete require.cache[require.resolve('../src/http-auth')];
    delete require.cache[require.resolve('../src/nostr-auth')];
    delete require.cache[require.resolve('../src/webrtc-gateway')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/app')];

    const db = require('../src/db');
    db.initDb();
    store = require('../src/store');
    auth = require('../src/nostr-auth');
    app = require('../src/app');

    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(function(done) {
    if (server) {
      server.close(() => {
        if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        if (oldDataDir) process.env.DATA_DIR = oldDataDir;
        else delete process.env.DATA_DIR;
        if (oldDbPath) process.env.DB_PATH = oldDbPath;
        else delete process.env.DB_PATH;
        done();
      });
      return;
    }

    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
    done();
  });

  it('issues a cookie when the bootstrap token is confirmed', async function() {
    const gatewayIdentity = auth.loadGatewayIdentity();
    const requesterSk = generateSecretKey();
    const requesterPubkey = getPublicKey(requesterSk);
    store.upsertAccessPrincipal({
      pubkey: requesterPubkey,
      label: 'Confirm user',
      role: 'operator',
      scope: 'dashboard',
    });

    const bootstrap = auth.handleBootstrapEvent({
      event: auth.createBootstrapRequestEvent({
        requesterSk,
        gatewayPubkey: gatewayIdentity.pubkey,
        sessionId: 'acc-confirm-test',
        nonce: 'nonce-confirm-test',
      }),
      gatewayIdentity,
      metadata: { source: 'test' },
    });

    assert.equal(bootstrap.ok, true);
    assert.ok(bootstrap.bootstrap_cookie_token);

    const res = await fetch(`${baseUrl}/api/access/sessions/${bootstrap.session.id}/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ token: bootstrap.bootstrap_cookie_token }),
    });

    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.session.id, bootstrap.session.id);
    assert.match(res.headers.get('set-cookie') || '', /ops_access_session=acc-confirm-test/);
  });
});
