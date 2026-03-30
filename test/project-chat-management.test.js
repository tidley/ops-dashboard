const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('project chat management', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let app;
  let store;
  let project;
  let server;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-chat-management-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];
    delete require.cache[require.resolve('../src/app')];

    app = require('../src/app');
    store = require('../src/store');

    project = store.createProject({
      name: 'Chat Management Project',
      description: 'Regression test project',
      tags: ['test'],
      settings: {},
    });

    const pubkey = 'b'.repeat(64);
    store.upsertAccessPrincipal({
      pubkey,
      label: 'Chat Management Test',
      role: 'viewer',
      scope: 'dashboard',
      allowed: true,
    });
    store.issueAccessSession({
      pubkey,
      scope: 'dashboard',
      state: 'active',
      session_id: 'acc-chat-management',
      nonce: 'nonce-chat-management',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    server = app.listen(0);
  });

  after(function(done) {
    if (server) {
      server.close(() => {
        server = null;
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

  it('creates a new chat session and dedicated conversation subagent from project settings', async function() {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/${project.id}/chats/new`, {
      method: 'POST',
      headers: {
        cookie: 'ops_access_session=acc-chat-management',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `return_to=${encodeURIComponent(`/project/${project.id}?tab=conversations`)}`,
      redirect: 'manual',
    });

    const location = response.headers.get('location') || '';
    const sessionMatch = location.match(/[?&]session=([^&]+)/);
    assert.equal(response.status, 302);
    assert.match(location, new RegExp(`^/project/${project.id}\\?tab=conversations&session=`));
    assert.ok(sessionMatch);

    const sessionId = decodeURIComponent(sessionMatch[1]);
    const state = store.getProjectState(project.id);
    const sessionAgent = store.ensureSessionConversationAgent(project.id, sessionId);

    assert.ok(sessionId.startsWith('ses-'));
    assert.equal(state.last_tab, 'conversations');
    assert.equal(state.last_session_id, sessionId);
    assert.ok(sessionAgent);
    assert.equal(sessionAgent.config_json.conversation_scope, 'session');
    assert.equal(sessionAgent.config_json.conversation_session_id, sessionId);
  });
});
