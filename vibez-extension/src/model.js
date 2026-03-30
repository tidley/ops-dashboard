const crypto = require('crypto');
const path = require('path');

function normalizeProjectPath(projectPath) {
  if (!projectPath) return '';
  return path.resolve(String(projectPath));
}

function makeProjectId(projectPath) {
  return crypto
    .createHash('sha1')
    .update(normalizeProjectPath(projectPath))
    .digest('hex')
    .slice(0, 12);
}

function sanitizeSlug(value, fallback = 'project', limit = 24) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit);
  return slug || fallback;
}

function buildTmuxSessionName(projectPath, prefix = 'vibez') {
  const resolved = normalizeProjectPath(projectPath);
  const baseName = sanitizeSlug(path.basename(resolved || ''), 'project', 24);
  const cleanPrefix = sanitizeSlug(prefix, 'vibez', 12);
  const suffix = makeProjectId(resolved).slice(0, 8);
  return `${cleanPrefix}-${baseName}-${suffix}`;
}

function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortByRecentActivity(projects) {
  return projects.slice().sort((left, right) => {
    const leftTime = Math.max(toTimestamp(left.lastOpenedAt), toTimestamp(left.lastSwitchedAt));
    const rightTime = Math.max(toTimestamp(right.lastOpenedAt), toTimestamp(right.lastSwitchedAt));
    if (leftTime !== rightTime) return rightTime - leftTime;
    return `${left.name || ''}`.localeCompare(`${right.name || ''}`);
  });
}

function sortAlphabetically(projects) {
  return projects.slice().sort((left, right) => {
    const nameCmp = `${left.name || ''}`.localeCompare(`${right.name || ''}`);
    if (nameCmp !== 0) return nameCmp;
    return `${left.path || ''}`.localeCompare(`${right.path || ''}`);
  });
}

function matchesSearch(project, rawSearch) {
  const search = String(rawSearch || '').trim().toLowerCase();
  if (!search) return true;
  const haystack = [
    project.name,
    project.path,
    project.relativePath,
    project.branch,
    project.lastCommitSubject,
    project.tmuxSessionName,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(search);
}

function groupProjects(projects, options = {}) {
  const recentLimit = Math.max(1, Number(options.recentLimit) || 8);
  const filtered = Array.isArray(projects)
    ? projects.filter(project => matchesSearch(project, options.search))
    : [];

  const pinned = sortByRecentActivity(filtered.filter(project => project.pinned));
  const recents = sortByRecentActivity(
    filtered.filter(project => !project.pinned && (project.lastOpenedAt || project.lastSwitchedAt)),
  ).slice(0, recentLimit);

  const excluded = new Set([
    ...pinned.map(project => project.id),
    ...recents.map(project => project.id),
  ]);

  const others = sortAlphabetically(filtered.filter(project => !excluded.has(project.id)));

  return {
    pinned,
    recents,
    others,
    filteredCount: filtered.length,
    totalCount: Array.isArray(projects) ? projects.length : 0,
  };
}

function buildProjectRecord({
  projectPath,
  rootPath,
  metadata = {},
  git = {},
  pinned = false,
  currentWorkspacePath = '',
}) {
  const resolvedPath = normalizeProjectPath(projectPath);
  const resolvedRoot = normalizeProjectPath(rootPath);
  const relativePath = resolvedRoot && resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
    ? path.relative(resolvedRoot, resolvedPath)
    : path.basename(resolvedPath);

  return {
    id: makeProjectId(resolvedPath),
    name: path.basename(resolvedPath),
    path: resolvedPath,
    relativePath: relativePath || path.basename(resolvedPath),
    branch: git.branch || '',
    ahead: Number(git.ahead || 0),
    behind: Number(git.behind || 0),
    dirtyCount: Number(git.dirtyCount || 0),
    untrackedCount: Number(git.untrackedCount || 0),
    lastCommitSubject: git.lastCommitSubject || '',
    lastCommitRelative: git.lastCommitRelative || '',
    lastCommitShortHash: git.lastCommitShortHash || '',
    isGitRepo: Boolean(git.isGitRepo),
    pinned: Boolean(pinned),
    current: normalizeProjectPath(currentWorkspacePath) === resolvedPath,
    lastOpenedAt: metadata.lastOpenedAt || '',
    lastSwitchedAt: metadata.lastSwitchedAt || '',
    switchCount: Number(metadata.switchCount || 0),
    tmuxSessionName: metadata.tmuxSessionName || '',
    tmuxAttachedAt: metadata.tmuxAttachedAt || '',
    note: metadata.note || '',
  };
}

module.exports = {
  buildProjectRecord,
  buildTmuxSessionName,
  groupProjects,
  makeProjectId,
  normalizeProjectPath,
  sortAlphabetically,
  sortByRecentActivity,
};
