const assert = require('assert');
const {
  buildProjectRecord,
  buildTmuxSessionName,
  groupProjects,
  normalizeSortMode,
} = require('../vibez-extension/src/model');
const { parseGitStatusSummary } = require('../vibez-extension/src/git');
const { parseTmuxSessionNames } = require('../vibez-extension/src/tmux');
const { buildCodeLaunchArgs } = require('../vibez-extension/src/windows');

describe('vibez model helpers', function() {
  it('builds stable tmux session names', function() {
    const one = buildTmuxSessionName('/home/tom/code/ops-dashboard', 'Vibez');
    const two = buildTmuxSessionName('/home/tom/code/ops-dashboard', 'Vibez');
    const other = buildTmuxSessionName('/home/tom/code/sec06', 'Vibez');

    assert.equal(one, two);
    assert.match(one, /^vibez-ops-dashbo-[a-f0-9]{8}$/);
    assert.notEqual(one, other);
  });

  it('groups live, pinned, recents, and remaining projects', function() {
    const projects = [
      buildProjectRecord({
        projectPath: '/tmp/alpha',
        rootPath: '/tmp',
        metadata: { lastOpenedAt: '2026-03-29T10:00:00.000Z' },
        pinned: false,
      }),
      buildProjectRecord({
        projectPath: '/tmp/bravo',
        rootPath: '/tmp',
        metadata: { lastOpenedAt: '2026-03-30T10:00:00.000Z', activeTmuxSession: true },
        pinned: true,
      }),
      buildProjectRecord({
        projectPath: '/tmp/charlie',
        rootPath: '/tmp',
        metadata: { lastOpenedAt: '2026-03-30T09:00:00.000Z' },
        pinned: false,
      }),
      buildProjectRecord({
        projectPath: '/tmp/delta',
        rootPath: '/tmp',
        metadata: {},
        pinned: false,
      }),
    ];

    const grouped = groupProjects(projects, { recentLimit: 2 });

    assert.deepStrictEqual(grouped.live.map(project => project.name), ['bravo']);
    assert.deepStrictEqual(grouped.pinned.map(project => project.name), []);
    assert.deepStrictEqual(grouped.recents.map(project => project.name), ['charlie', 'alpha']);
    assert.deepStrictEqual(grouped.others.map(project => project.name), ['delta']);
  });

  it('sorts projects by last updated and moves archived projects to a separate group', function() {
    const projects = [
      buildProjectRecord({
        projectPath: '/tmp/alpha',
        rootPath: '/tmp',
        metadata: {},
        git: { lastCommitAt: '2026-03-30T09:00:00.000Z' },
      }),
      buildProjectRecord({
        projectPath: '/tmp/bravo',
        rootPath: '/tmp',
        metadata: { archived: true },
        git: { lastCommitAt: '2026-03-31T10:00:00.000Z' },
      }),
      buildProjectRecord({
        projectPath: '/tmp/charlie',
        rootPath: '/tmp',
        metadata: {},
        git: { lastCommitAt: '2026-03-30T12:00:00.000Z' },
      }),
    ];

    const grouped = groupProjects(projects, { sortMode: 'updated', recentLimit: 1 });

    assert.deepStrictEqual(grouped.others.map(project => project.name), ['charlie', 'alpha']);
    assert.deepStrictEqual(grouped.archived.map(project => project.name), ['bravo']);
  });

  it('parses git branch and dirty summary', function() {
    const parsed = parseGitStatusSummary([
      '## main...origin/main [ahead 2, behind 1]',
      ' M src/extension.js',
      '?? media/main.css',
    ].join('\n'));

    assert.equal(parsed.branch, 'main');
    assert.equal(parsed.ahead, 2);
    assert.equal(parsed.behind, 1);
    assert.equal(parsed.dirtyCount, 1);
    assert.equal(parsed.untrackedCount, 1);
  });

  it('builds VS Code launch args for multi-window mode', function() {
    assert.deepStrictEqual(
      buildCodeLaunchArgs('/tmp/demo', { newWindow: true }),
      ['--new-window', '/tmp/demo'],
    );

    assert.deepStrictEqual(
      buildCodeLaunchArgs('/tmp/demo', { reuseWindow: true, profile: 'Vibez' }),
      ['--reuse-window', '--profile', 'Vibez', '/tmp/demo'],
    );
  });

  it('normalizes project sort modes', function() {
    assert.equal(normalizeSortMode('updated'), 'updated');
    assert.equal(normalizeSortMode('name'), 'name');
    assert.equal(normalizeSortMode('else'), 'name');
  });

  it('parses tmux session lists', function() {
    const parsed = parseTmuxSessionNames('\n vibez-alpha-1234 \n\nvibez-bravo-5678\n');

    assert.deepStrictEqual(Array.from(parsed), ['vibez-alpha-1234', 'vibez-bravo-5678']);
  });
});
