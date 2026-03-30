const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('node:child_process');

describe('openclaw thread sessions', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let originalExecFile;
  let capturedSessionIds;
  let app;
  let store;
  let db;
  let project;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-thread-sessions-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');
    process.env.OPENCLAW_BIN = path.join(tmpDir, 'fake-openclaw');

    capturedSessionIds = [];
    originalExecFile = childProcess.execFile;
    childProcess.execFile = (command, args, options, callback) => {
      const env = options && options.env ? options.env : {};
      capturedSessionIds.push(env.OPENCLAW_SESSION_ID || '');
      const sessionIndex = Array.isArray(args) ? args.indexOf('--session-id') : -1;
      const payload = {
        reply: 'ok',
        captured: {
          command,
          sessionId: sessionIndex >= 0 ? (args[sessionIndex + 1] || '') : '',
        },
      };
      callback(null, JSON.stringify(payload), '');
    };

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];
    delete require.cache[require.resolve('../src/app')];

    db = require('../src/db');
    db.initDb();
    store = require('../src/store');
    store.seedDefaults();
    app = require('../src/app');

    project = store.createProject({
      name: `Thread Sessions ${Date.now()}`,
      description: 'Per-thread OpenClaw session regression',
      tags: ['test'],
      settings: {},
    });
  });

  after(function() {
    if (originalExecFile) childProcess.execFile = originalExecFile;
    if (process.env.OPENCLAW_BIN) delete process.env.OPENCLAW_BIN;
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('uses distinct OpenClaw session ids for project chat and OpenClaw Main', async function() {
    const chatResponse = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: 'Project chat thread',
        message_type: 'prompt',
      },
      acceptHeader: 'application/json',
    });

    const mainResponse = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: 'OpenClaw Main thread',
        message_type: 'prompt',
        agent_id: 'agent-openclaw-main',
        session_id: chatResponse.body.session_id,
      },
      acceptHeader: 'application/json',
    });

    assert.equal(chatResponse.ok, true);
    assert.equal(mainResponse.ok, true);
    assert.equal(capturedSessionIds.length >= 2, true);
    assert.notEqual(capturedSessionIds[0], capturedSessionIds[1]);
    assert.match(capturedSessionIds[0], /opsdash:/);
    assert.match(capturedSessionIds[1], /opsdash:/);
    assert.match(capturedSessionIds[1], /agent-openclaw-main/);
  });
});
