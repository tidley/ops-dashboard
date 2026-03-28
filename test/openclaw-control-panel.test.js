const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

describe('home openclaw control panel', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let oldBin;
  let oldLogLevel;
  let logFile;
  let app;
  let store;
  let server;
  let baseUrl;

  before(async function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    oldBin = process.env.OPENCLAW_BIN;
    oldLogLevel = process.env.OPENCLAW_LOG_LEVEL;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-openclaw-panel-'));
    logFile = path.join(tmpDir, 'calls.jsonl');
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');
    process.env.OPENCLAW_LOG_LEVEL = 'error';
    process.env.FAKE_OPENCLAW_LOG = logFile;

    const fakeBin = path.join(tmpDir, 'fake-openclaw.js');
    const script = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const logFile = process.env.FAKE_OPENCLAW_LOG;
if (logFile) fs.appendFileSync(logFile, JSON.stringify({ args }) + '\\n');
const models = {
  configPath: '/home/tom/.openclaw/openclaw.json',
  agentDir: '/home/tom/.openclaw/agents/main/agent',
  defaultModel: 'openai-codex/gpt-5.3-codex',
  resolvedDefault: 'openai-codex/gpt-5.3-codex',
  fallbacks: ['openrouter/stepfun/step-3.5-flash:free'],
  imageModel: null,
  imageFallbacks: [],
  allowed: ['openai-codex/gpt-5.4', 'openai-codex/gpt-5.3-codex', 'openai-codex/gpt-5.2'],
  auth: { providersWithOAuth: ['openai-codex (1)'], providers: [{ provider: 'openai-codex', status: 'ok', effective: { kind: 'profiles' } }], profiles: [] },
};
const status = {
  runtimeVersion: '2026.3.24',
  heartbeat: { defaultAgentId: 'main', agents: [{ agentId: 'main', enabled: true, every: '30m', everyMs: 1800000 }] },
  channelSummary: ['Nostr (NIP-17): configured', '  - default'],
  queuedSystemEvents: [],
  sessions: { count: 486, recent: [{ sessionId: 'ses-1' }, { sessionId: 'ses-2' }] },
};
const gateway = {
  service: {
    loaded: false,
    loadedText: 'enabled',
    runtime: { status: 'unknown', detail: 'systemctl --user unavailable' },
    configAudit: { ok: false, issues: [{ code: 'gateway-path-missing', message: 'Gateway service PATH is not set.' }] },
  },
  config: { cli: { path: '/home/tom/.openclaw/openclaw.json', exists: true, valid: true } },
  gateway: { bindMode: 'loopback', bindHost: '127.0.0.1', port: 18789 },
  port: { port: 18789, status: 'free', listeners: [] },
  rpc: { ok: false, error: 'gateway closed (1006 abnormal closure)' },
  extraServices: [],
};
if (args[0] === 'models' && args[1] === 'status' && args[2] === '--json') {
  process.stdout.write(JSON.stringify(models));
  process.exit(0);
}
if (args[0] === 'status' && args[1] === '--json') {
  process.stdout.write(JSON.stringify(status));
  process.exit(0);
}
if (args[0] === 'gateway' && args[1] === 'status' && args.includes('--json')) {
  process.stdout.write(JSON.stringify(gateway));
  process.exit(0);
}
if (args[0] === 'gateway' && args[1] === 'restart') process.exit(0);
if (args[0] === 'models' && args[1] === 'set') process.exit(0);
if (args[0] === 'models' && args[1] === 'fallbacks' && ['clear', 'add'].includes(args[2])) process.exit(0);
process.exit(1);
`;
    fs.writeFileSync(fakeBin, script);
    fs.chmodSync(fakeBin, 0o755);
    process.env.OPENCLAW_BIN = fakeBin;

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/access')];
    delete require.cache[require.resolve('../src/http-auth')];
    delete require.cache[require.resolve('../src/nostr-auth')];
    delete require.cache[require.resolve('../src/webrtc-gateway')];
    delete require.cache[require.resolve('../src/openclaw-control')];
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
        if (oldBin) process.env.OPENCLAW_BIN = oldBin;
        else delete process.env.OPENCLAW_BIN;
        if (oldLogLevel) process.env.OPENCLAW_LOG_LEVEL = oldLogLevel;
        else delete process.env.OPENCLAW_LOG_LEVEL;
        delete process.env.FAKE_OPENCLAW_LOG;
        done();
      });
      return;
    }

    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
    if (oldBin) process.env.OPENCLAW_BIN = oldBin;
    else delete process.env.OPENCLAW_BIN;
    if (oldLogLevel) process.env.OPENCLAW_LOG_LEVEL = oldLogLevel;
    else delete process.env.OPENCLAW_LOG_LEVEL;
    delete process.env.FAKE_OPENCLAW_LOG;
    done();
  });

  it('renders a control panel with live gateway and model data', async function() {
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
      session_id: 'acc-openclaw-panel',
      nonce: 'nonce-openclaw-panel',
      state: 'active',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await fetch(`${baseUrl}/`, {
      headers: {
        cookie: `ops_access_session=${session.id}`,
        accept: 'text/html',
      },
    });
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(html, /OpenClaw control/);
    assert.match(html, /Settings/);
    assert.match(html, /Models, gateway, and runtime/);
    assert.match(html, /data-openclaw-control-root/);
    assert.match(html, /home-openclaw-control\.js/);
    assert.match(html, /data-openclaw-model-select/);
    assert.match(html, /data-openclaw-fallbacks/);
    assert.match(html, /Loading channel status|No gateway audit issues|unknown/);
  });

  it('serves the live openclaw control snapshot asynchronously', async function() {
    const res = await fetch(`${baseUrl}/api/openclaw/control-panel`, {
      headers: {
        cookie: `ops_access_session=${store.issueAccessSession({
          pubkey: '2f5759825226f1d57ef1652ba66114b2f938f7f5c50dc505708e5d8b31e4f3c9',
          scope: 'dashboard',
          session_id: 'acc-openclaw-panel-api',
          nonce: 'nonce-openclaw-panel-api',
          state: 'active',
          issued_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }).id}`,
      },
    });

    const snapshot = await res.json();
    assert.equal(res.status, 200);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.summary.defaultModel, 'openai-codex/gpt-5.3-codex');
    assert.match(snapshot.summary.gatewayRpcError, /gateway closed/);
    assert.ok(Array.isArray(snapshot.summary.allowedModels));
  });

  it('routes gateway restarts through the openclaw cli', async function() {
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
      session_id: 'acc-openclaw-panel-restart',
      nonce: 'nonce-openclaw-panel-restart',
      state: 'active',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await fetch(`${baseUrl}/api/openclaw/gateway/restart`, {
      method: 'POST',
      headers: {
        cookie: `ops_access_session=${session.id}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'return_to=%2F',
      redirect: 'manual',
    });

    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') || '', /openclaw_notice=Gateway%20restart%20requested/);

    const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(calls[calls.length - 1].args, ['gateway', 'restart']);
  });
});
