const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

describe('project workspace launch', function() {
  let tmpDir;
  let repoDir;
  let oldDataDir;
  let oldDbPath;
  let app;
  let store;
  let project;
  let server;
  let baseUrl;
  let launchCalls;

  before(async function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-workspace-launch-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-workspace-root-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    const runtimePath = require.resolve('../src/workspace-runtime');
    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[runtimePath];
    delete require.cache[require.resolve('../src/app')];

    launchCalls = [];
    require.cache[runtimePath] = {
      id: runtimePath,
      filename: runtimePath,
      loaded: true,
      exports: {
        preferredPortForProject: () => 18081,
        findAvailablePort: async () => 18081,
        probePort: async () => false,
        launchCodeServer: (input) => {
          launchCalls.push(input);
          return {
            pid: 43210,
            logPath: '/tmp/code-server-workspace-launch-test.log',
          };
        },
        waitForPort: async () => true,
      },
    };

    app = require('../src/app');
    store = require('../src/store');

    project = store.createProject({
      name: 'Workspace Launch Project',
      description: 'Regression test project',
      tags: ['test'],
      settings: {
        imported_from: repoDir,
      },
    });

    const pubkey = 'c'.repeat(64);
    store.upsertAccessPrincipal({
      pubkey,
      label: 'Workspace Launch Test',
      role: 'viewer',
      scope: 'dashboard',
      allowed: true,
    });
    store.issueAccessSession({
      pubkey,
      scope: 'dashboard',
      state: 'active',
      session_id: 'acc-workspace-launch',
      nonce: 'nonce-workspace-launch',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

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
    delete require.cache[require.resolve('../src/app')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/workspace-runtime')];

    const finish = () => {
      if (repoDir && fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true, force: true });
      if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      if (oldDataDir) process.env.DATA_DIR = oldDataDir;
      else delete process.env.DATA_DIR;
      if (oldDbPath) process.env.DB_PATH = oldDbPath;
      else delete process.env.DB_PATH;
      done();
    };

    if (server) {
      server.close(() => {
        server = null;
        finish();
      });
      return;
    }

    finish();
  });

  it('launches a local code-server session for an unconfigured project and redirects to the proxy route', async function() {
    const response = await fetch(`${baseUrl}/api/projects/${project.id}/workspace/launch`, {
      method: 'POST',
      headers: {
        cookie: 'ops_access_session=acc-workspace-launch',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `return_to=${encodeURIComponent(`/project/${project.id}?tab=overview`)}`,
      redirect: 'manual',
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/workspace/${project.id}/`);
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0].workspacePath, repoDir);
    assert.equal(launchCalls[0].port, 18081);

    const updated = store.getProject(project.id);
    assert.equal(updated.settings_json.workspace_url, 'http://127.0.0.1:18081');
    assert.equal(updated.settings_json.workspace_embed_url, 'http://127.0.0.1:18081');
    assert.equal(updated.settings_json.workspace_popout_url, 'http://127.0.0.1:18081');
    assert.equal(updated.settings_json.workspace_provider, 'code-server');
    assert.equal(updated.settings_json.workspace_status_label, 'warm');
  });
});
