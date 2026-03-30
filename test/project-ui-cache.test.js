const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('project ui cache', function() {
  let tmpDir;
  let repoDir;
  let oldDataDir;
  let oldDbPath;
  let oldPlanningWriteDebounceMs;
  let app;
  let store;
  let project;
  let server;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    oldPlanningWriteDebounceMs = process.env.PLANNING_WRITE_DEBOUNCE_MS;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-ui-cache-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');
    process.env.PLANNING_WRITE_DEBOUNCE_MS = '0';

    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.planning', 'NOW.md'), '# now\n');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];
    delete require.cache[require.resolve('../src/app')];

    app = require('../src/app');
    store = require('../src/store');

    project = store.createProject({
      name: 'UI Cache Project',
      description: 'Cache test project',
      tags: [],
      settings: {
        imported_from: repoDir,
      },
    });

    const pubkey = 'b'.repeat(64);
    store.upsertAccessPrincipal({
      pubkey,
      label: 'Cache Test',
      role: 'viewer',
      scope: 'dashboard',
      allowed: true,
    });
    store.issueAccessSession({
      pubkey,
      scope: 'dashboard',
      state: 'active',
      session_id: 'acc-ui-cache',
      nonce: 'nonce-ui-cache',
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
        if (oldPlanningWriteDebounceMs != null) process.env.PLANNING_WRITE_DEBOUNCE_MS = oldPlanningWriteDebounceMs;
        else delete process.env.PLANNING_WRITE_DEBOUNCE_MS;
        done();
      });
      return;
    }

    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
    if (oldPlanningWriteDebounceMs != null) process.env.PLANNING_WRITE_DEBOUNCE_MS = oldPlanningWriteDebounceMs;
    else delete process.env.PLANNING_WRITE_DEBOUNCE_MS;
    done();
  });

  it('renders planning tab from cached db state before live refresh updates it', async function() {
    store.updateProjectUiCache(project.id, {
      planningFiles: [
        {
          file_path: '.planning/CACHED.md',
          relative_path: 'CACHED.md',
          name: 'CACHED.md',
          directory: '',
          updated_at: '2026-03-30T00:00:00.000Z',
          size_bytes: 12,
        },
      ],
      workspaceDir: repoDir,
      workspaceBranch: '',
      recentFileChanges: [],
      latestCommit: null,
    });

    fs.rmSync(path.join(repoDir, '.planning'), { recursive: true, force: true });

    const port = server.address().port;
    const cookie = 'ops_access_session=acc-ui-cache';

    const cachedResponse = await fetch(`http://127.0.0.1:${port}/project/${project.id}?tab=files`, {
      headers: { cookie },
    });
    const cachedHtml = await cachedResponse.text();

    assert.equal(cachedResponse.status, 200);
    assert.match(cachedHtml, /\.planning workspace/);
    assert.match(cachedHtml, /CACHED\.md/);

    const refreshResponse = await fetch(`http://127.0.0.1:${port}/api/project/${project.id}/planning-files`, {
      headers: {
        cookie,
        accept: 'application/json',
      },
    });
    const refreshJson = await refreshResponse.json();

    assert.equal(refreshResponse.status, 200);
    assert.ok(Array.isArray(refreshJson.files));
    assert.ok(refreshJson.files.length > 0);
    assert.equal(refreshJson.files.some((file) => file.file_path === '.planning/NOW.md'), true);

    const refreshedResponse = await fetch(`http://127.0.0.1:${port}/project/${project.id}?tab=files`, {
      headers: { cookie },
    });
    const refreshedHtml = await refreshedResponse.text();

    assert.equal(refreshedResponse.status, 200);
    assert.match(refreshedHtml, /NOW\.md/);
    assert.doesNotMatch(refreshedHtml, /CACHED\.md/);
  });

  it('uses the db-backed planning bundle and restores markdown files when they are missing', async function() {
    store.updateProjectUiCache(project.id, {
      projectPlanningBundle: {
        scope: 'project',
        rootDir: path.join(repoDir, '.planning'),
        now: '# NOW\n\n1. Cached task\n- from db\n',
        next: '',
        backlog: '',
        risks: '',
        status: '# Status\n\n## Objective\nStay cached.\n\n## Current state\n- Synced from DB\n',
        todo: '',
        decisions: '',
        log: '',
        context: '',
      },
    });

    fs.rmSync(path.join(repoDir, '.planning'), { recursive: true, force: true });

    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/project/${project.id}`, {
      headers: { cookie: 'ops_access_session=acc-ui-cache' },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(fs.existsSync(path.join(repoDir, '.planning', 'NOW.md')), true);
    assert.equal(fs.existsSync(path.join(repoDir, '.planning', 'STATUS.md')), true);
    assert.match(fs.readFileSync(path.join(repoDir, '.planning', 'NOW.md'), 'utf8'), /Cached task/);
    assert.match(fs.readFileSync(path.join(repoDir, '.planning', 'STATUS.md'), 'utf8'), /Synced from DB/);
  });

  it('writes the markdown mirror immediately when planning state is updated in the db', function() {
    fs.rmSync(path.join(repoDir, '.planning'), { recursive: true, force: true });

    store.updateProjectUiCache(project.id, {
      projectPlanningBundle: {
        scope: 'project',
        rootDir: path.join(repoDir, '.planning'),
        now: '# NOW\n\n1. Immediate write\n',
        next: '',
        backlog: '',
        risks: '',
        status: '# Status\n\n## Objective\nMirror immediately.\n',
        todo: '',
        decisions: '',
        log: '',
        context: '',
      },
    });

    assert.equal(fs.existsSync(path.join(repoDir, '.planning', 'NOW.md')), true);
    assert.equal(fs.existsSync(path.join(repoDir, '.planning', 'STATUS.md')), true);
    assert.match(fs.readFileSync(path.join(repoDir, '.planning', 'NOW.md'), 'utf8'), /Immediate write/);
    assert.match(fs.readFileSync(path.join(repoDir, '.planning', 'STATUS.md'), 'utf8'), /Mirror immediately/);
  });
});
