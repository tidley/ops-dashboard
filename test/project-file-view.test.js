const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('project file viewer', function() {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-file-view-'));
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
      name: 'File Viewer Project',
      description: 'Regression test project',
      tags: [],
      settings: {},
    });
    fs.writeFileSync(path.join(project.workspace_dir, 'README.md'), 'alpha\nbeta\n');

    const pubkey = 'a'.repeat(64);
    store.upsertAccessPrincipal({
      pubkey,
      label: 'Viewer Test',
      role: 'viewer',
      scope: 'dashboard',
      allowed: true,
    });
    store.issueAccessSession({
      pubkey,
      scope: 'dashboard',
      state: 'active',
      session_id: 'acc-file-view',
      nonce: 'nonce-file-view',
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

  it('renders a line-numbered full file viewer in a pop-out window', async function() {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/project/${project.id}/file?path=README.md`, {
      headers: {
        cookie: 'ops_access_session=acc-file-view',
      },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Full file/);
    assert.match(html, /README\.md/);
    assert.match(html, /file-viewer__line-no/);
    assert.match(html, /alpha/);
    assert.match(html, /beta/);
  });
});
