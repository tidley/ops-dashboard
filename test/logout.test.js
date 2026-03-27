const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

describe('logout route', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let app;
  let store;
  let server;
  let baseUrl;

  before(async function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-logout-'));
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

  it('revokes the current session and clears the cookie', async function() {
    const principal = store.upsertAccessPrincipal({
      pubkey: '2f5759825226f1d57ef1652ba66114b2f938f7f5c50dc505708e5d8b31e4f3c9',
      label: 'Tom access',
      role: 'operator',
      scope: 'dashboard',
      allowed: true,
    });
    const session = store.issueAccessSession({
      pubkey: principal.pubkey,
      scope: 'dashboard',
      session_id: 'acc-logout-test',
      nonce: 'nonce-logout-test',
      state: 'active',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: {
        cookie: `ops_access_session=${session.id}`,
        accept: 'text/html',
      },
      redirect: 'manual',
    });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/access');
    const setCookie = res.headers.get('set-cookie') || '';
    assert.match(setCookie, /ops_access_session=/);
    assert.match(setCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);

    const revoked = store.getAccessSession(session.id);
    assert.equal(revoked.state, 'revoked');
    assert.ok(revoked.revoked_at);
  });
});
