const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('openclaw control panel', function() {
  let tmpDir;
  let logFile;
  let fakeBin;
  let control;
  let oldBin;
  let oldLogLevel;

  before(function() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-openclaw-control-'));
    logFile = path.join(tmpDir, 'calls.jsonl');
    fakeBin = path.join(tmpDir, 'fake-openclaw.js');

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
  allowed: ['openai-codex/gpt-5.4', 'openai-codex/gpt-5.3-codex'],
  auth: {
    providersWithOAuth: ['openai-codex (1)'],
    providers: [{ provider: 'openai-codex', status: 'ok', effective: { kind: 'profiles' } }],
    profiles: [{ profileId: 'openai-codex:default', provider: 'openai-codex', type: 'oauth', status: 'ok' }],
  },
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
    configAudit: { ok: true, issues: [] },
  },
  config: { cli: { path: '/home/tom/.openclaw/openclaw.json', exists: true, valid: true } },
  gateway: { bindMode: 'loopback', bindHost: '127.0.0.1', port: 18789 },
  port: { port: 18789, status: 'free', listeners: [] },
  rpc: { ok: false, error: 'gateway closed (1006 abnormal closure)' },
  extraServices: [],
};

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

if (process.env.FAKE_OPENCLAW_MODELS_FAIL === '1' && args[0] === 'models' && args[1] === 'status' && args[2] === '--json') {
  console.error('openclaw models status failed');
  process.exit(2);
}
if (args[0] === 'models' && args[1] === 'status' && args[2] === '--json') return emit(models);
if (args[0] === 'status' && args[1] === '--json') return emit(status);
if (args[0] === 'gateway' && args[1] === 'status' && args.includes('--json')) return emit(gateway);
if (args[0] === 'gateway' && args[1] === 'restart') return process.exit(0);
if (args[0] === 'models' && args[1] === 'set') return process.exit(0);
if (args[0] === 'models' && args[1] === 'fallbacks' && ['clear', 'add'].includes(args[2])) return process.exit(0);

console.error('unexpected args:', args.join(' '));
process.exit(1);
`;

    fs.writeFileSync(fakeBin, script);
    fs.chmodSync(fakeBin, 0o755);

    oldBin = process.env.OPENCLAW_BIN;
    oldLogLevel = process.env.OPENCLAW_LOG_LEVEL;
    process.env.OPENCLAW_BIN = fakeBin;
    process.env.FAKE_OPENCLAW_LOG = logFile;
    process.env.OPENCLAW_LOG_LEVEL = 'error';

    delete require.cache[require.resolve('../src/openclaw-control')];
    control = require('../src/openclaw-control');
  });

  after(function() {
    if (oldBin) process.env.OPENCLAW_BIN = oldBin;
    else delete process.env.OPENCLAW_BIN;
    if (oldLogLevel) process.env.OPENCLAW_LOG_LEVEL = oldLogLevel;
    else delete process.env.OPENCLAW_LOG_LEVEL;
    delete process.env.FAKE_OPENCLAW_LOG;
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collects live gateway and model stats from the cli', async function() {
    const snapshot = await control.refreshOpenClawControlPanel({ force: true });

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.summary.defaultModel, 'openai-codex/gpt-5.3-codex');
    assert.equal(snapshot.summary.fallbackModels[0], 'openrouter/stepfun/step-3.5-flash:free');
    assert.equal(snapshot.summary.runtimeVersion, '2026.3.24');
    assert.equal(snapshot.summary.sessionCount, 486);
    assert.equal(snapshot.summary.gatewayBindHost, '127.0.0.1');
    assert.equal(snapshot.summary.gatewayPort, 18789);
    assert.equal(snapshot.summary.gatewayRpcOk, false);
    assert.match(snapshot.summary.gatewayRpcError, /gateway closed/);
    assert.ok(Array.isArray(snapshot.summary.channelSummary));
    assert.ok(Array.isArray(snapshot.summary.allowedModels));
  });

  it('keeps the panel usable when models status fails', async function() {
    process.env.FAKE_OPENCLAW_MODELS_FAIL = '1';
    const snapshot = await control.refreshOpenClawControlPanel({ force: true });
    delete process.env.FAKE_OPENCLAW_MODELS_FAIL;

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.summary.modelsStatusOk, false);
    assert.match(snapshot.summary.modelsStatusError, /openclaw models status failed/i);
    assert.ok(Array.isArray(snapshot.summary.allowedModels));
    assert.ok(snapshot.summary.defaultModel);
    assert.ok(Array.isArray(snapshot.warnings));
    assert.match(snapshot.warnings[0], /openclaw models status failed/i);
  });

  it('restarts the gateway and updates models through the cli', function() {
    fs.writeFileSync(logFile, '');
    control.restartOpenClawGateway();
    control.setOpenClawDefaultModel('openai-codex/gpt-5.4');
    control.setOpenClawFallbackModels('openrouter/stepfun/step-3.5-flash:free,  openai-codex/gpt-5.2');

    const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(calls.map((entry) => entry.args), [
      ['gateway', 'restart'],
      ['models', 'set', 'openai-codex/gpt-5.4'],
      ['models', 'fallbacks', 'clear'],
      ['models', 'fallbacks', 'add', 'openrouter/stepfun/step-3.5-flash:free'],
      ['models', 'fallbacks', 'add', 'openai-codex/gpt-5.2'],
    ]);
  });
});
