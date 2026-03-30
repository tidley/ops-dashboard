const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    redirectArgs: null,
    clearedCookie: null,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    redirect(status, location) {
      this.redirectArgs = { status, location };
      return this;
    },
    clearCookie(name, options) {
      this.clearedCookie = { name, options };
      return this;
    },
  };
}

describe('http auth guard', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let store;
  let auth;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-http-auth-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/access')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/http-auth')];

    const db = require('../src/db');
    db.initDb();
    store = require('../src/store');
    auth = require('../src/http-auth');
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('allows public paths without a session cookie', function() {
    const middleware = auth.createRequireAccess({ store });
    let called = false;
    const req = { path: '/access', url: '/access', headers: {} };
    const res = createMockRes();

    middleware(req, res, () => { called = true; });

    assert.equal(called, true);
    assert.equal(res.redirectArgs, null);
  });

  it('redirects unauthenticated html requests to access', function() {
    const middleware = auth.createRequireAccess({ store });
    const req = {
      path: '/',
      url: '/',
      originalUrl: '/project/proj-1',
      headers: { accept: 'text/html' },
      accepts(type) {
        return type === 'html' ? 'html' : false;
      },
      get(name) {
        if (name === 'accept') return 'text/html';
        return '';
      },
    };
    const res = createMockRes();

    middleware(req, res, () => {});

    assert.equal(res.redirectArgs.status, 302);
    assert.equal(res.redirectArgs.location, '/access?next=%2Fproject%2Fproj-1');
    assert.equal(res.clearedCookie.name, auth.AUTH_COOKIE_NAME);
  });

  it('returns json 401 for unauthenticated api requests', function() {
    const middleware = auth.createRequireAccess({ store });
    const req = {
      path: '/api/project/proj-1/message',
      url: '/api/project/proj-1/message',
      headers: { accept: 'application/json' },
      get(name) {
        if (name === 'accept') return 'application/json';
        return '';
      },
    };
    const res = createMockRes();

    middleware(req, res, () => {});

    assert.equal(res.statusCode, 401);
    assert.deepStrictEqual(res.body, { error: 'authentication_required' });
  });

  it('redirects unauthenticated dashboard root requests to access', function() {
    const middleware = auth.createRequireAccess({ store });
    const req = {
      path: '/',
      url: '/',
      originalUrl: '/',
      headers: { accept: 'text/html' },
      accepts(type) {
        return type === 'html' ? 'html' : false;
      },
      get(name) {
        if (name === 'accept') return 'text/html';
        return '';
      },
    };
    const res = createMockRes();

    middleware(req, res, () => {});

    assert.equal(res.redirectArgs.status, 302);
    assert.equal(res.redirectArgs.location, '/access?next=%2F');
  });

  it('allows authenticated requests with an active access session', function() {
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
      session_id: 'acc-auth-test',
      nonce: 'nonce-auth-test',
      state: 'active',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const middleware = auth.createRequireAccess({ store });
    let called = false;
    const req = {
      path: '/project/proj-1',
      url: '/project/proj-1',
      headers: { cookie: `${auth.AUTH_COOKIE_NAME}=${session.id}` },
      cookies: { [auth.AUTH_COOKIE_NAME]: session.id },
      get(name) {
        if (name === 'accept') return 'text/html';
        return '';
      },
      accepts(type) {
        return type === 'html' ? 'html' : false;
      },
    };
    const res = createMockRes();
    const before = store.getAccessSession(session.id);

    middleware(req, res, () => { called = true; });
    const after = store.getAccessSession(session.id);

    assert.equal(called, true);
    assert.equal(req.accessSession.id, session.id);
    assert.ok(after.expires_at > before.expires_at, 'expected access session expiry to refresh');
    assert.ok(after.last_seen_at >= before.last_seen_at, 'expected last_seen_at to refresh');
  });
});
