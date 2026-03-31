const assert = require('assert');
const {
  getArchiveCollapsed,
  getPendingSwitch,
  getPinnedProjects,
  getProjectState,
  getProjectSortMode,
  setArchiveCollapsed,
  setPendingSwitch,
  setProjectSortMode,
  toggleArchivedProject,
  togglePinnedProject,
  touchProjectRecent,
} = require('../vibez-extension/src/storage');
const {
  clearWindowAlive,
  getLiveWindowForProject,
  listLiveWindows,
  markWindowAlive,
} = require('../vibez-extension/src/windows');
const { buildAttachCommand } = require('../vibez-extension/src/tmux');

function createContext(initialState = {}) {
  const store = { ...initialState };
  return {
    globalState: {
      get(key, fallback) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
      },
      async update(key, value) {
        store[key] = value;
      },
    },
    __store: store,
  };
}

describe('vibez storage helpers', function() {
  it('persists archive collapse and sort mode globally', async function() {
    const context = createContext();

    assert.equal(getArchiveCollapsed(context), true);
    assert.equal(getProjectSortMode(context), 'name');

    await setArchiveCollapsed(context, false);
    await setProjectSortMode(context, 'updated');

    assert.equal(getArchiveCollapsed(context), false);
    assert.equal(getProjectSortMode(context), 'updated');
  });

  it('toggles pinning and archiving for projects', async function() {
    const context = createContext();
    const projectPath = '/tmp/vibez-demo';

    assert.equal(getPinnedProjects(context).has(projectPath), false);
    assert.equal(Boolean(getProjectState(context, projectPath).archived), false);

    await togglePinnedProject(context, projectPath);
    await toggleArchivedProject(context, projectPath);

    assert.equal(getPinnedProjects(context).has(projectPath), true);
    assert.equal(getProjectState(context, projectPath).archived, true);

    await toggleArchivedProject(context, projectPath);
    assert.equal(getProjectState(context, projectPath).archived, false);
  });

  it('tracks recent project activity and pending switch state', async function() {
    const context = createContext();
    const projectPath = '/tmp/recent-project';

    const touched = await touchProjectRecent(context, projectPath, {
      tmuxSessionName: 'vibez-recent-project-1234abcd',
    });

    assert.equal(touched.switchCount, 1);
    assert.equal(typeof touched.lastOpenedAt, 'string');
    assert.equal(touched.tmuxSessionName, 'vibez-recent-project-1234abcd');

    await setPendingSwitch(context, {
      projectPath,
      tmuxSessionName: 'vibez-recent-project-1234abcd',
    });

    assert.deepStrictEqual(getPendingSwitch(context), {
      projectPath,
      tmuxSessionName: 'vibez-recent-project-1234abcd',
    });
  });

  it('tracks live window registry entries and filters stale ones', async function() {
    const freshSeenAt = new Date().toISOString();
    const staleSeenAt = new Date(Date.now() - (45 * 1000)).toISOString();
    const context = createContext({
      'vibez.windowRegistry': {
        '/tmp/fresh': { windowSessionId: 'fresh-1', lastSeenAt: freshSeenAt },
        '/tmp/stale': { windowSessionId: 'stale-1', lastSeenAt: staleSeenAt },
      },
    });

    const liveWindows = listLiveWindows(context);
    assert.deepStrictEqual(liveWindows.map((entry) => entry.projectPath), ['/tmp/fresh']);
    assert.equal(getLiveWindowForProject(context, '/tmp/fresh').windowSessionId, 'fresh-1');
    assert.equal(getLiveWindowForProject(context, '/tmp/stale'), null);

    await markWindowAlive(context, {
      projectPath: '/tmp/marked',
      windowSessionId: 'mark-1',
    });
    assert.equal(getLiveWindowForProject(context, '/tmp/marked').windowSessionId, 'mark-1');

    await clearWindowAlive(context, {
      projectPath: '/tmp/marked',
      windowSessionId: 'mark-1',
    });
    assert.equal(getLiveWindowForProject(context, '/tmp/marked'), null);
  });

  it('builds shell-safe tmux attach commands', function() {
    const command = buildAttachCommand({
      projectPath: "/tmp/project's path",
      sessionName: "vibez-demo-session",
    });

    assert.match(command, /tmux new-session -A -s 'vibez-demo-session' -c '\/tmp\/project'\\''s path'/);
  });
});
