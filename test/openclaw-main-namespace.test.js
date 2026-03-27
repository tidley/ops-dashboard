const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('openclaw main namespace', function() {
  let app;
  let store;
  let tmpDir;
  let oldDataDir;
  let oldDbPath;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-main-namespace-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];
    delete require.cache[require.resolve('../src/app')];

    const db = require('../src/db');
    db.initDb();
    app = require('../src/app');
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

  it('keeps the OpenClaw Main namespace hidden from project lists', function() {
    const mainProject = store.ensureOpenClawMainProject();
    assert.ok(mainProject, 'expected a main-agent namespace project');
    assert.equal(mainProject.id, 'proj-openclaw-main');
    assert.equal(mainProject.settings_json.hidden, true);
    assert.equal(store.listProjects().some((project) => project.id === mainProject.id), false);
  });

  it('stores OpenClaw Main messages separately from the current project chat', async function() {
    const project = store.createProject({
      name: `Namespace Project ${Date.now()}`,
      description: 'Namespace regression project',
      tags: ['test'],
      settings: {},
    });

    const chatResponse = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: 'Project chat message',
        message_type: 'prompt',
      },
      acceptHeader: 'application/json',
    });

    const mainResponse = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: 'OpenClaw Main message',
        message_type: 'prompt',
        agent_id: 'agent-openclaw-main',
      },
      acceptHeader: 'application/json',
    });

    assert.equal(chatResponse.ok, true);
    assert.equal(mainResponse.ok, true);

    const projectMessages = store.listProjectMessages(project.id, 20);
    assert.equal(projectMessages.some((message) => message.content === 'OpenClaw Main message'), false);
    assert.equal(projectMessages.some((message) => message.content === 'Project chat message'), true);

    const mainProject = store.ensureOpenClawMainProject();
    const mainMessages = store.listProjectMessages(mainProject.id, 20);
    assert.equal(mainMessages.some((message) => message.content === 'OpenClaw Main message'), true);
    assert.equal(mainMessages.some((message) => message.content === 'Project chat message'), false);
  });
});
