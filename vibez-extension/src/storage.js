const { normalizeProjectPath, normalizeSortMode } = require('./model');

const STORAGE_KEYS = {
  pinned: 'vibez.pinnedProjects',
  projects: 'vibez.projectState',
  pendingSwitch: 'vibez.pendingSwitch',
  sortMode: 'vibez.projectSortMode',
  archiveCollapsed: 'vibez.archiveCollapsed',
};

function readArray(context, key) {
  const value = context.globalState.get(key, []);
  return Array.isArray(value) ? value : [];
}

function readObject(context, key) {
  const value = context.globalState.get(key, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getPinnedProjects(context) {
  return new Set(
    readArray(context, STORAGE_KEYS.pinned)
      .map(normalizeProjectPath)
      .filter(Boolean),
  );
}

async function setPinnedProjects(context, pinnedProjects) {
  const next = Array.from(new Set(Array.from(pinnedProjects).map(normalizeProjectPath).filter(Boolean))).sort();
  await context.globalState.update(STORAGE_KEYS.pinned, next);
}

async function togglePinnedProject(context, projectPath) {
  const normalized = normalizeProjectPath(projectPath);
  const pinned = getPinnedProjects(context);
  if (pinned.has(normalized)) {
    pinned.delete(normalized);
  } else {
    pinned.add(normalized);
  }
  await setPinnedProjects(context, pinned);
  return pinned.has(normalized);
}

function getProjectStateMap(context) {
  return readObject(context, STORAGE_KEYS.projects);
}

function getProjectState(context, projectPath) {
  const normalized = normalizeProjectPath(projectPath);
  return getProjectStateMap(context)[normalized] || {};
}

async function updateProjectState(context, projectPath, patch = {}) {
  const normalized = normalizeProjectPath(projectPath);
  const current = getProjectStateMap(context);
  current[normalized] = {
    ...(current[normalized] || {}),
    ...(patch || {}),
  };
  await context.globalState.update(STORAGE_KEYS.projects, current);
  return current[normalized];
}

async function touchProjectRecent(context, projectPath, patch = {}) {
  const timestamp = new Date().toISOString();
  const current = getProjectState(context, projectPath);
  return updateProjectState(context, projectPath, {
    lastOpenedAt: timestamp,
    lastSwitchedAt: timestamp,
    switchCount: Number(current.switchCount || 0) + 1,
    ...(patch || {}),
  });
}

async function setProjectArchived(context, projectPath, archived) {
  return updateProjectState(context, projectPath, {
    archived: Boolean(archived),
  });
}

async function toggleArchivedProject(context, projectPath) {
  const current = getProjectState(context, projectPath);
  return setProjectArchived(context, projectPath, !current.archived);
}

function getPendingSwitch(context) {
  const pending = context.globalState.get(STORAGE_KEYS.pendingSwitch, null);
  return pending && typeof pending === 'object' ? pending : null;
}

async function setPendingSwitch(context, payload) {
  await context.globalState.update(STORAGE_KEYS.pendingSwitch, payload || null);
}

function getProjectSortMode(context) {
  return normalizeSortMode(context.globalState.get(STORAGE_KEYS.sortMode, 'name'));
}

async function setProjectSortMode(context, sortMode) {
  await context.globalState.update(STORAGE_KEYS.sortMode, normalizeSortMode(sortMode));
}

function getArchiveCollapsed(context) {
  return context.globalState.get(STORAGE_KEYS.archiveCollapsed, true) !== false;
}

async function setArchiveCollapsed(context, collapsed) {
  await context.globalState.update(STORAGE_KEYS.archiveCollapsed, Boolean(collapsed));
}

module.exports = {
  getArchiveCollapsed,
  getPendingSwitch,
  getPinnedProjects,
  getProjectState,
  getProjectSortMode,
  setArchiveCollapsed,
  setPendingSwitch,
  setProjectArchived,
  setProjectSortMode,
  togglePinnedProject,
  toggleArchivedProject,
  touchProjectRecent,
  updateProjectState,
};
