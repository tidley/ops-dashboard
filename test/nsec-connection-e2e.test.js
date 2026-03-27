const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('@roamhq/wrtc');
const { generateSecretKey, getPublicKey, nip19 } = require('nostr-tools');

function loadAccessWebRtcProxy() {
  const script = fs.readFileSync(path.join(__dirname, '..', 'src/public/webrtc-proxy.js'), 'utf8');
  const context = vm.createContext({
    window: {},
    crypto: {
      randomUUID() {
        return `uuid-${Math.random().toString(16).slice(2)}`;
      },
    },
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceCandidate,
    Headers,
    fetch,
    setTimeout,
    clearTimeout,
    console,
    JSON,
    Promise,
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
  });
  context.window = context;
  vm.runInContext(script, context, { filename: 'webrtc-proxy.js' });
  return context.window.AccessWebRtcProxy;
}

describe('nsec connection e2e', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let store;
  let auth;
  let WebRtcGateway;
  let AccessWebRtcProxy;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-nsec-e2e-'));
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
    WebRtcGateway = require('../src/webrtc-gateway').WebRtcGateway;
    store.seedDefaults();
    AccessWebRtcProxy = loadAccessWebRtcProxy();
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('bootstraps and connects with a local nsec signer', async function() {
    this.timeout(30000);

    const requesterSk = generateSecretKey();
    const nsec = nip19.nsecEncode(requesterSk);
    const decoded = nip19.decode(nsec);
    const requesterSkDecoded = decoded.data;
    assert.deepStrictEqual(Array.from(requesterSkDecoded), Array.from(requesterSk));
    const requesterPubkey = getPublicKey(requesterSkDecoded);
    store.upsertAccessPrincipal({
      pubkey: requesterPubkey,
      label: 'nsec e2e user',
      role: 'operator',
      scope: 'dashboard',
    });
    assert.equal(store.isAccessAllowed(requesterPubkey), true);

    const gatewayIdentity = auth.loadGatewayIdentity();
    const webRtcGateway = new WebRtcGateway({
      store,
      baseUrl: 'http://10.10.0.2:1717',
    });

    const directTransport = {
      sessionId: '',
      async bootstrap(bootstrapEvent, bootstrapMeta = {}) {
        const result = auth.handleBootstrapEvent({
          event: bootstrapEvent,
          gatewayIdentity,
          metadata: {
            source: 'nsec-e2e',
            relay_urls: [],
            requested_transport: 'webrtc-direct',
            signal_envelope: 'nip17',
          },
        });
        if (!result.ok) {
          throw new Error(result.error || 'bootstrap_failed');
        }
        this.sessionId = result.session.id;
        return result;
      },
      async signal(signal) {
        const sessionId = this.sessionId || signal.session_id;
        return webRtcGateway.handleSignal(sessionId, signal);
      },
    };

    const proxy = new AccessWebRtcProxy({ signalTransport: directTransport });

    const bootstrapPayload = {
      app: auth.ACCESS_APP,
      type: 'bootstrap_request',
      pubkey: requesterPubkey,
      session_id: `acc-nsec-${Date.now()}`,
      nonce: `nsec-${Date.now()}`,
      scope: 'dashboard',
      transport: 'webrtc-direct',
      relay_urls: [],
      stun_urls: ['stun:fips.tomdwyer.uk:3478'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    const bootstrapEvent = nip19 ? auth.createBootstrapRequestEvent({
      requesterSk,
      gatewayPubkey: gatewayIdentity.pubkey,
      sessionId: bootstrapPayload.session_id,
      nonce: bootstrapPayload.nonce,
      scope: 'dashboard',
      extra: {
        transport: 'webrtc-direct',
        relay_urls: [],
        stun_urls: ['stun:fips.tomdwyer.uk:3478'],
      },
    }) : null;

    const bootstrap = await proxy.bootstrap('/api/access/bootstrap', bootstrapEvent, { payload: bootstrapPayload });
    assert.equal(bootstrap.ok, true);
    assert.equal(bootstrap.session.pubkey, requesterPubkey);
    assert.equal(bootstrap.session.state, 'active');
    assert.equal(bootstrap.signal_url, `/api/access/sessions/${bootstrap.session.id}/signal`);

    await proxy.connect();
    assert.equal(proxy.connected, true);

    const response = await proxy.proxyFetch('/', { method: 'GET' });
    assert.equal(response.status, 200);
    assert.match(response.body, /Ops Dashboard|Project Detail|Projects/);

    proxy.close();
    webRtcGateway.closeSession(bootstrap.session.id, 'test_complete');
  });
});
