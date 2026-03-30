const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('conversation agent sessions', function() {
  let tmpDir;
  let oldDataDir;
  let oldDbPath;
  let store;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-conversation-agent-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];

    const db = require('../src/db');
    db.initDb();
    store = require('../src/store');
    store.seedDefaults();
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('creates a dedicated subagent per chat session', function() {
    const project = store.createProject({
      name: `Conversation Agent Project ${Date.now()}`,
      description: 'Project-specific subagent regression',
      tags: ['test'],
      settings: {},
    });

    const sessionA = store.ensureSession(project.id, 'ses-agent-a', null);
    const sessionB = store.ensureSession(project.id, 'ses-agent-b', null);

    const agentA1 = store.ensureSessionConversationAgent(project.id, sessionA.id);
    const agentA2 = store.ensureSessionConversationAgent(project.id, sessionA.id);
    const agentB = store.ensureSessionConversationAgent(project.id, sessionB.id);
    const agentDirect = store.ensureProjectConversationAgent(project.id);

    assert.ok(agentA1, 'expected first session agent');
    assert.ok(agentB, 'expected second session agent');
    assert.ok(agentDirect, 'expected project agent');
    assert.equal(agentA1.id, agentA2.id);
    assert.notEqual(agentA1.id, agentB.id);
    assert.notEqual(agentA1.id, agentDirect.id);
    assert.notEqual(agentB.id, agentDirect.id);
    assert.equal(agentA1.config_json.conversation_subagent, true);
    assert.equal(agentB.config_json.conversation_subagent, true);
    assert.equal(agentA1.config_json.project_id, project.id);
    assert.equal(agentB.config_json.project_id, project.id);
    assert.equal(agentA1.config_json.conversation_scope, 'session');
    assert.equal(agentB.config_json.conversation_scope, 'session');
    assert.equal(agentA1.config_json.conversation_session_id, sessionA.id);
    assert.equal(agentB.config_json.conversation_session_id, sessionB.id);
    assert.equal(agentDirect.config_json.conversation_scope, 'project');

    const refreshed = store.getProject(project.id);
    const agentIds = refreshed.agents.map((agent) => agent.id);
    assert.ok(agentIds.includes(agentDirect.id));
    assert.ok(!agentIds.includes(agentA1.id));
    assert.ok(!agentIds.includes(agentB.id));
  });

  it('keeps project agents distinct across projects', function() {
    const projectA = store.createProject({
      name: `Conversation Agent Project A ${Date.now()}`,
      description: 'Project agent regression A',
      tags: ['test'],
      settings: {},
    });
    const projectB = store.createProject({
      name: `Conversation Agent Project B ${Date.now()}`,
      description: 'Project agent regression B',
      tags: ['test'],
      settings: {},
    });

    const agentA = store.ensureProjectConversationAgent(projectA.id);
    const agentB = store.ensureProjectConversationAgent(projectB.id);

    assert.ok(agentA);
    assert.ok(agentB);
    assert.notEqual(agentA.id, agentB.id);
    assert.equal(agentA.config_json.conversation_scope, 'project');
    assert.equal(agentB.config_json.conversation_scope, 'project');
  });
});
