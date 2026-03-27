const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('project ignore list', function() {
  let tmpDir;
  let ignoreFile;
  let oldDataDir;
  let oldDbPath;
  let oldIgnoreFile;
  let store;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    oldIgnoreFile = process.env.PROJECT_IGNORE_FILE;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-ignore-'));
    ignoreFile = path.join(tmpDir, '.opsdashboardignore');
    fs.writeFileSync(ignoreFile, [
      'wf-state-test-*',
      'prune-test-*',
      'session-test-*',
    ].join('\n'));

    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');
    process.env.PROJECT_IGNORE_FILE = ignoreFile;

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/access')];
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
    if (oldIgnoreFile) process.env.PROJECT_IGNORE_FILE = oldIgnoreFile;
    else delete process.env.PROJECT_IGNORE_FILE;
  });

  it('hides projects whose names match gitignore-style patterns', function() {
    store.createProject({ name: `wf-state-test-${Date.now()}` });
    store.createProject({ name: `prune-test-${Date.now()}` });
    store.createProject({ name: `session-test-${Date.now()}` });
    store.createProject({ name: `visible-project-${Date.now()}` });

    const names = store.listProjects().map(project => project.name);

    assert.equal(names.some(name => name.startsWith('wf-state-test-')), false);
    assert.equal(names.some(name => name.startsWith('prune-test-')), false);
    assert.equal(names.some(name => name.startsWith('session-test-')), false);
    assert.equal(names.some(name => name.startsWith('visible-project-')), true);
  });
});
