const assert = require('assert');
const {
  buildProjectRecord,
  buildTmuxSessionName,
  groupProjects,
} = require('../vibez-extension/src/model');
const { parseGitStatusSummary } = require('../vibez-extension/src/git');

describe('vibez model helpers', function() {
  it('builds stable tmux session names', function() {
    const one = buildTmuxSessionName('/home/tom/code/ops-dashboard', 'Vibez');
    const two = buildTmuxSessionName('/home/tom/code/ops-dashboard', 'Vibez');
    const other = buildTmuxSessionName('/home/tom/code/sec06', 'Vibez');

    assert.equal(one, two);
    assert.match(one, /^vibez-ops-dashboard-[a-f0-9]{8}$/);
    assert.notEqual(one, other);
  });

  it('groups pinned, recents, and remaining projects', function() {
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
        metadata: { lastOpenedAt: '2026-03-30T10:00:00.000Z' },
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

    assert.deepStrictEqual(grouped.pinned.map(project => project.name), ['bravo']);
    assert.deepStrictEqual(grouped.recents.map(project => project.name), ['charlie', 'alpha']);
    assert.deepStrictEqual(grouped.others.map(project => project.name), ['delta']);
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
});
