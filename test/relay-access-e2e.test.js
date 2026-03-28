const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { finalizeEvent, generateSecretKey, getPublicKey, nip17 } = require('nostr-tools');

describe('relay access e2e', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let store;
  let auth;
  let relayAccess;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-relay-e2e-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/access')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/nostr-auth')];
    delete require.cache[require.resolve('../src/nostr-relay-access')];

    const db = require('../src/db');
    db.initDb();
    store = require('../src/store');
    auth = require('../src/nostr-auth');
    relayAccess = require('../src/nostr-relay-access');
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('accepts bootstrap and answer signalling over relays', async function() {
    const gatewayIdentity = auth.loadGatewayIdentity();
    const requesterSk = generateSecretKey();
    const requesterPubkey = getPublicKey(requesterSk);
    const sessionId = 'acc-relay-e2e';

    store.upsertAccessPrincipal({
      pubkey: requesterPubkey,
      label: 'Relay user',
      role: 'operator',
      scope: 'dashboard',
      allowed: true,
    });

    const published = [];
    const fakePool = {
      publish(relays, event) {
        published.push({ relays, event });
        return [Promise.resolve(true)];
      },
      subscribeMany() {
        return { close() {} };
      },
    };

    const fakeGateway = {
      ensureSession(accessSessionId) {
        const accessSession = store.getAccessSession(accessSessionId);
        if (!accessSession) return { ok: false, error: 'access_session_not_found' };
        return {
          ok: true,
          session: {
            id: accessSessionId,
            accessSession,
          },
        };
      },
      async handleSignal(accessSessionId, signal) {
        assert.equal(accessSessionId, sessionId);
        assert.equal(signal.type, 'offer');
        return {
          ok: true,
          type: 'answer',
          sdp: { type: 'answer', sdp: 'fake-answer' },
          candidates: [{ candidate: 'candidate:1' }],
          signal: { type: 'offer', accepted: true },
        };
      },
      closeSession() {},
    };

    const controller = new relayAccess.NostrRelayAccessController({
      store,
      webRtcGateway: fakeGateway,
      gatewayIdentity,
      relays: ['wss://relay.example.test'],
      logger: { info() {}, warn() {}, error() {} },
    });
    controller.pool = fakePool;

    const bootstrapEvent = auth.createBootstrapRequestEvent({
      requesterSk,
      gatewayPubkey: gatewayIdentity.pubkey,
      sessionId,
      nonce: 'relay-e2e-bootstrap',
    });

    await controller.handleEvent(bootstrapEvent);

    assert.equal(published.length, 1);
    let unwrapped = nip17.unwrapEvent(published[0].event, requesterSk);
    unwrapped = JSON.parse(unwrapped.content);
    assert.equal(unwrapped.type, 'bootstrap_accept');
    assert.equal(unwrapped.session.id, sessionId);
    assert.equal(unwrapped.signal_url, `/api/access/sessions/${sessionId}/signal`);
    assert.equal(unwrapped.proxy_url, `/api/access/sessions/${sessionId}/proxy`);
    assert.equal(store.getAccessSession(sessionId).state, 'active');

    const offerEvent = nip17.wrapEvent(
      requesterSk,
      { publicKey: gatewayIdentity.pubkey },
      JSON.stringify({
        app: auth.ACCESS_APP,
        type: 'offer',
        session_id: sessionId,
        sdp: { type: 'offer', sdp: 'fake-offer' },
      }),
    );

    await controller.handleEvent(offerEvent);

    assert.equal(published.length, 2);
    unwrapped = nip17.unwrapEvent(published[1].event, requesterSk);
    unwrapped = JSON.parse(unwrapped.content);
    assert.equal(unwrapped.type, 'answer');
    assert.equal(unwrapped.session_id, sessionId);
    assert.deepStrictEqual(unwrapped.candidates, [{ candidate: 'candidate:1' }]);
  });

  it('accepts plain signed bootstrap and answer signalling over relays', async function() {
    const gatewayIdentity = auth.loadGatewayIdentity();
    const requesterSk = generateSecretKey();
    const requesterPubkey = getPublicKey(requesterSk);
    const sessionId = 'acc-relay-plain-e2e';

    store.upsertAccessPrincipal({
      pubkey: requesterPubkey,
      label: 'Relay plain user',
      role: 'operator',
      scope: 'dashboard',
      allowed: true,
    });

    const published = [];
    const fakePool = {
      publish(relays, event) {
        published.push({ relays, event });
        return [Promise.resolve(true)];
      },
      subscribeMany() {
        return { close() {} };
      },
    };

    const fakeGateway = {
      ensureSession(accessSessionId) {
        const accessSession = store.getAccessSession(accessSessionId);
        if (!accessSession) return { ok: false, error: 'access_session_not_found' };
        return {
          ok: true,
          session: {
            id: accessSessionId,
            accessSession,
          },
        };
      },
      async handleSignal(accessSessionId, signal) {
        assert.equal(accessSessionId, sessionId);
        assert.equal(signal.type, 'offer');
        return {
          ok: true,
          type: 'answer',
          sdp: { type: 'answer', sdp: 'plain-answer' },
          candidates: [{ candidate: 'candidate:2' }],
          signal: { type: 'offer', accepted: true },
        };
      },
      closeSession() {},
    };

    const controller = new relayAccess.NostrRelayAccessController({
      store,
      webRtcGateway: fakeGateway,
      gatewayIdentity,
      relays: ['wss://relay.example.test'],
      logger: { info() {}, warn() {}, error() {} },
    });
    controller.pool = fakePool;

    const bootstrapPayload = {
      app: auth.ACCESS_APP,
      type: 'bootstrap_request',
      pubkey: requesterPubkey,
      session_id: sessionId,
      nonce: 'relay-plain-bootstrap',
      scope: 'dashboard',
      issued_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    const bootstrapEvent = finalizeEvent({
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', gatewayIdentity.pubkey]],
      content: JSON.stringify(bootstrapPayload),
    }, requesterSk);

    await controller.handleEvent(bootstrapEvent);

    assert.equal(published.length, 1);
    let payload = JSON.parse(published[0].event.content);
    assert.equal(payload.type, 'bootstrap_accept');
    assert.equal(payload.session.id, sessionId);
    assert.equal(payload.signal_url, `/api/access/sessions/${sessionId}/signal`);
    assert.equal(payload.proxy_url, `/api/access/sessions/${sessionId}/proxy`);
    assert.equal(store.getAccessSession(sessionId).state, 'active');

    const offerEvent = finalizeEvent({
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', gatewayIdentity.pubkey]],
      content: JSON.stringify({
        app: auth.ACCESS_APP,
        type: 'offer',
        session_id: sessionId,
        sdp: { type: 'offer', sdp: 'plain-offer' },
      }),
    }, requesterSk);

    await controller.handleEvent(offerEvent);

    assert.equal(published.length, 2);
    payload = JSON.parse(published[1].event.content);
    assert.equal(payload.type, 'answer');
    assert.equal(payload.session_id, sessionId);
    assert.deepStrictEqual(payload.candidates, [{ candidate: 'candidate:2' }]);
  });

  it('provides a broader default relay pool for browser sign-in', function() {
    const urls = relayAccess.defaultRelayUrls();
    assert.ok(urls.length >= 5, 'expected more than the old two-relay default');
    assert.ok(urls.includes('wss://relay.damus.io'));
    assert.ok(urls.includes('wss://relay.primal.net'));
    assert.ok(urls.includes('wss://relay.nostr.band'));
    assert.ok(urls.includes('wss://relay.snort.social'));
    assert.ok(urls.includes('wss://nos.lol'));
    assert.ok(urls.includes('wss://nostr.mom'));
  });
});
