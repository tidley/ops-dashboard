const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('auth policy', function() {
  let store;
  let access;
  let tmpDir;
  let oldDataDir;
  let oldDbPath;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-auth-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/access')];
    delete require.cache[require.resolve('../src/store')];

    const db = require('../src/db');
    db.initDb();
    store = require('../src/store');
    access = require('../src/access');
    store.seedDefaults();
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('stores allowlisted pubkeys and preserves revocation state', function() {
    const pubkey = 'a'.repeat(64);
    const principal = store.upsertAccessPrincipal({
      pubkey,
      label: 'Alice',
      role: 'admin',
      scope: 'dashboard',
    });

    assert.equal(principal.pubkey, pubkey);
    assert.equal(principal.label, 'Alice');
    assert.equal(principal.role, 'admin');
    assert.equal(principal.scope, 'dashboard');
    assert.equal(principal.allowed, true);
    assert.equal(store.isAccessAllowed(pubkey), true);

    const revoked = store.revokeAccessPrincipal(pubkey);
    assert.equal(revoked.allowed, false);
    assert.ok(revoked.revoked_at);
    assert.equal(store.isAccessAllowed(pubkey), false);

    const activePrincipals = store.listAccessPrincipals();
    assert.equal(activePrincipals.some((row) => row.pubkey === pubkey), false);

    const allPrincipals = store.listAccessPrincipals(true);
    assert.equal(allPrincipals.some((row) => row.pubkey === pubkey && row.allowed === false), true);
  });

  it('seeds only the allowed access pubkey by default', function() {
    const pubkey = '2f5759825226f1d57ef1652ba66114b2f938f7f5c50dc505708e5d8b31e4f3c9';
    const principal = store.getAccessPrincipal(pubkey);
    assert.ok(principal, 'expected the default access pubkey to exist');
    assert.equal(principal.allowed, true);
    assert.equal(principal.label, 'Tom access');
    assert.equal(store.isAccessAllowed(pubkey), true);

    const activePrincipals = store.listAccessPrincipals();
    assert.deepStrictEqual(activePrincipals.map((row) => row.pubkey), [pubkey]);
    assert.equal(activePrincipals.some((row) => row.allowed === true && row.pubkey !== pubkey), false);
  });

  it('revokes any other allowed access principals on seedDefaults', function() {
    const roguePubkey = 'e'.repeat(64);
    store.upsertAccessPrincipal({
      pubkey: roguePubkey,
      label: 'Rogue access',
      role: 'operator',
      scope: 'dashboard',
    });
    assert.equal(store.isAccessAllowed(roguePubkey), true);

    store.seedDefaults();

    assert.equal(store.isAccessAllowed(roguePubkey), false);
    const allPrincipals = store.listAccessPrincipals(true);
    assert.equal(allPrincipals.some((row) => row.pubkey === roguePubkey && row.allowed === true), false);
  });

  it('issues access sessions only for allowlisted pubkeys and supports revocation', function() {
    const pubkey = 'b'.repeat(64);
    store.upsertAccessPrincipal({
      pubkey,
      label: 'Bob',
      role: 'operator',
      scope: 'dashboard',
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const session = store.issueAccessSession({
      pubkey,
      scope: 'dashboard',
      nonce: 'nonce-1',
      issued_at: issuedAt,
      expires_at: expiresAt,
      metadata: { project_id: 'proj-test' },
    });

    assert.ok(session.id.startsWith('acc-'));
    assert.equal(session.pubkey, pubkey);
    assert.equal(session.state, 'pending');
    assert.equal(session.metadata_json.project_id, 'proj-test');

    const touched = store.touchAccessSession(session.id, {
      state: 'active',
      last_seen_at: new Date().toISOString(),
    });

    assert.equal(touched.state, 'active');
    assert.ok(touched.last_seen_at);

    const revoked = store.revokeAccessSession(session.id, 'expired');
    assert.equal(revoked.state, 'revoked');
    assert.ok(revoked.revoked_at);
    assert.equal(revoked.metadata_json.revoked_reason, 'expired');
  });

  it('rejects access sessions for pubkeys that are not allowlisted', function() {
    const pubkey = 'c'.repeat(64);
    assert.throws(() => {
      store.issueAccessSession({
        pubkey,
        scope: 'dashboard',
        nonce: 'nonce-2',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    }, /pubkey_not_allowed/);
  });

  it('records replay tuples per session and pubkey', function() {
    const pubkey = 'd'.repeat(64);
    store.upsertAccessPrincipal({ pubkey, label: 'Replay Test', role: 'viewer', scope: 'dashboard' });

    const session = store.issueAccessSession({
      pubkey,
      scope: 'dashboard',
      nonce: 'nonce-3',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    assert.equal(store.rememberAccessReplay({ session_id: session.id, pubkey, nonce: 'replay-1' }), true);
    assert.equal(store.rememberAccessReplay({ session_id: session.id, pubkey, nonce: 'replay-1' }), false);
    assert.equal(store.hasAccessReplay({ session_id: session.id, pubkey, nonce: 'replay-1' }), true);

    const secondSession = store.issueAccessSession({
      pubkey,
      scope: 'dashboard',
      nonce: 'nonce-4',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    assert.equal(store.rememberAccessReplay({ session_id: secondSession.id, pubkey, nonce: 'replay-1' }), true);
  });

  it('exposes freshness helpers for future bootstrap validation', function() {
    const now = Date.now();
    assert.equal(access.isTimestampFresh(now - 1000, now + 1000, now), true);
    assert.equal(access.isTimestampFresh(now - 5000, now - 1000, now), false);
  });
});
