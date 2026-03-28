const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('node:child_process');

describe('recent file changes', function() {
  let tmpDir;
  let repoDir;
  let commitRepoDir;
  let oldDataDir;
  let oldDbPath;
  let app;

  before(function() {
    oldDataDir = process.env.DATA_DIR;
    oldDbPath = process.env.DB_PATH;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-recent-changes-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    childProcess.execSync('git init -q', { cwd: repoDir, stdio: 'ignore' });
    childProcess.execSync('git config user.email "ops@example.com"', { cwd: repoDir, stdio: 'ignore' });
    childProcess.execSync('git config user.name "Ops Dashboard"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\n');
    childProcess.execSync('git add README.md && git commit -q -m "initial"', { cwd: repoDir, stdio: 'ignore', shell: '/bin/bash' });
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\nworld\n');

    commitRepoDir = path.join(tmpDir, 'repo-commit');
    fs.mkdirSync(commitRepoDir, { recursive: true });
    childProcess.execSync('git init -q', { cwd: commitRepoDir, stdio: 'ignore' });
    childProcess.execSync('git config user.email "ops@example.com"', { cwd: commitRepoDir, stdio: 'ignore' });
    childProcess.execSync('git config user.name "Ops Dashboard"', { cwd: commitRepoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(commitRepoDir, 'README.md'), 'alpha\n');
    childProcess.execSync('git add README.md && git commit -q -m "initial"', { cwd: commitRepoDir, stdio: 'ignore', shell: '/bin/bash' });
    fs.writeFileSync(path.join(commitRepoDir, 'README.md'), 'alpha\nbeta\n');
    fs.writeFileSync(path.join(commitRepoDir, 'src.js'), 'console.log("one");\n');
    childProcess.execSync('git add README.md src.js && git commit -q -m "update readme and add src"', { cwd: commitRepoDir, stdio: 'ignore', shell: '/bin/bash' });

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];
    delete require.cache[require.resolve('../src/app')];

    app = require('../src/app');
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (oldDataDir) process.env.DATA_DIR = oldDataDir;
    else delete process.env.DATA_DIR;
    if (oldDbPath) process.env.DB_PATH = oldDbPath;
    else delete process.env.DB_PATH;
  });

  it('includes actual diff text for modified workspace files', function() {
    const changes = app.buildRecentFileChanges({
      workspace_dir: repoDir,
      settings_json: {},
    }, 10);

    assert.ok(Array.isArray(changes));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].file_path, 'README.md');
    assert.match(changes[0].change_detail, /Working tree/);
    assert.match(changes[0].change_detail, /@@/);
    assert.match(changes[0].change_detail, /\+world/);
  });

  it('captures the latest commit snapshot with changed files and diffs', function() {
    const snapshot = app.buildLatestCommitSnapshot({
      workspace_dir: commitRepoDir,
      settings_json: {},
    }, 10);

    assert.ok(snapshot);
    assert.ok(snapshot.hash);
    assert.match(snapshot.message, /update readme and add src/);
    assert.ok(Array.isArray(snapshot.files));
    assert.ok(snapshot.files.length >= 2);
    assert.equal(snapshot.files[0].file_path, 'README.md');
    assert.match(snapshot.files[0].change_detail, /Working tree|@@/);
    assert.match(snapshot.files[0].change_detail, /\+beta/);
  });
});
