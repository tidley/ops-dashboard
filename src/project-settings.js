const fs = require('fs');

function toText(value) {
  return `${value ?? ''}`.trim();
}

const AGENT_BACKEND_VALUES = new Set([
  'openclaw-proxy',
  'direct-codex',
  'direct-opencode',
  'routstr',
]);

function normalizeAgentBackendChoice(value, fallback = 'openclaw-proxy') {
  const text = `${value ?? ''}`.trim().toLowerCase().replace(/\s+/g, '-');
  if (!text) return fallback;
  if (text === 'inherit' || text === 'global' || text === 'global-default') return 'inherit';
  if (AGENT_BACKEND_VALUES.has(text)) return text;
  return fallback;
}

function normalizeFolderPath(value) {
  return toText(value)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
}

function normalizeFolderListField(value) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/g)
      : [];
  const seen = new Set();
  const items = [];
  for (const raw of rawItems) {
    const item = normalizeFolderPath(raw);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }
  return items;
}

function normalizeWorkspaceSettings(settings = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  return {
    codeFolder: toText(raw.code_folder || raw.imported_from || raw.workspace_dir || ''),
    subfolders: normalizeFolderListField(raw.subfolders || raw.code_subfolders || []),
    ignoreFolders: normalizeFolderListField(raw.ignore_folders || raw.ignored_folders || []),
    gettingStarted: toText(raw.getting_started || raw.instructions || ''),
    agentBackend: normalizeAgentBackendChoice(raw.agent_backend || raw.agentBackend || '', ''),
    routstrProvider: toText(raw.routstr_provider || raw.routstrProvider || ''),
    routstrModel: toText(raw.routstr_model || raw.routstrModel || ''),
  };
}

function normalizeProjectBackendSettings(settings = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  return {
    backendOverride: normalizeAgentBackendChoice(raw.backend_override || raw.backendOverride || '', 'inherit'),
    routstrProvider: toText(raw.routstr_provider || raw.routstrProvider || ''),
    routstrModel: toText(raw.routstr_model || raw.routstrModel || ''),
  };
}

function getProjectFolderSettings(project, globalSettings = {}) {
  const projectSettings = normalizeWorkspaceSettings(project?.settings_json || {});
  const globalWorkspaceSettings = normalizeWorkspaceSettings(globalSettings || {});
  const codeFolder = projectSettings.codeFolder || globalWorkspaceSettings.codeFolder || toText(project?.workspace_dir || '');
  const subfolders = globalWorkspaceSettings.subfolders;
  const ignoreFolders = globalWorkspaceSettings.ignoreFolders;
  const gettingStarted = projectSettings.gettingStarted || globalWorkspaceSettings.gettingStarted;
  return {
    codeFolder,
    subfolders,
    ignoreFolders,
    gettingStarted,
  };
}

function resolveAgentBackendSettings(project, globalSettings = {}) {
  const projectBackendSettings = normalizeProjectBackendSettings(project?.settings_json || {});
  const projectWorkspaceSettings = normalizeWorkspaceSettings(project?.settings_json || {});
  const globalWorkspaceSettings = normalizeWorkspaceSettings(globalSettings || {});

  const globalDefault = AGENT_BACKEND_VALUES.has(globalWorkspaceSettings.agentBackend)
    ? globalWorkspaceSettings.agentBackend
    : 'openclaw-proxy';
  const projectOverride = projectBackendSettings.backendOverride;
  const effectiveBackend = projectOverride && projectOverride !== 'inherit'
    ? projectOverride
    : globalDefault;

  return {
    effectiveBackend,
    source: projectOverride && projectOverride !== 'inherit'
      ? 'project'
      : (globalWorkspaceSettings.agentBackend ? 'global' : 'fallback'),
    projectOverride,
    globalDefault,
    routstrProvider: projectBackendSettings.routstrProvider || projectWorkspaceSettings.routstrProvider || globalWorkspaceSettings.routstrProvider || '',
    routstrModel: projectBackendSettings.routstrModel || projectWorkspaceSettings.routstrModel || globalWorkspaceSettings.routstrModel || '',
  };
}

function folderMatchesPrefix(filePath, folder) {
  const target = normalizeFolderPath(filePath);
  const prefix = normalizeFolderPath(folder);
  if (!target || !prefix) return false;
  return target === prefix || target.startsWith(`${prefix}/`);
}

function shouldIncludeRecentFile(filePath, projectFolderSettings) {
  const target = normalizeFolderPath(filePath);
  if (!target) return false;
  const settings = projectFolderSettings || {};
  const ignoreFolders = normalizeFolderListField(settings.ignoreFolders || []);
  const subfolders = normalizeFolderListField(settings.subfolders || []);
  if (ignoreFolders.some(folder => folderMatchesPrefix(target, folder))) return false;
  if (!subfolders.length) return true;
  return subfolders.some(folder => folderMatchesPrefix(target, folder));
}

function buildSubfolderSuggestions(root) {
  const suggestions = [];

  if (root && fs.existsSync(root)) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
      suggestions.push(...entries.slice(0, 12));
    } catch {
      // ignore unreadable folders
    }
  }

  return suggestions;
}

function buildGlobalSettingsWizard(settings = {}) {
  const workspaceSettings = normalizeWorkspaceSettings(settings);
  const root = workspaceSettings.codeFolder;
  const suggestions = buildSubfolderSuggestions(root);

  return {
    ...workspaceSettings,
    agentBackend: workspaceSettings.agentBackend || 'openclaw-proxy',
    suggestedSubfolders: suggestions,
    commonIgnoreFolders: ['node_modules', 'dist', 'build', 'coverage', '.git', '.cache', 'tmp'],
    starterInstructions: [
      'Start by reading the repository README and the project settings.',
      'Focus on the configured subfolders first.',
      'Avoid files in the ignored folders.',
      'Summarize what to change before editing code.',
    ].join('\n'),
  };
}

function buildProjectSettingsWizard(project, globalSettings = {}) {
  const settings = getProjectFolderSettings(project, globalSettings);
  const backendSettings = resolveAgentBackendSettings(project, globalSettings);
  return {
    codeFolder: settings.codeFolder,
    backendOverride: backendSettings.projectOverride,
    agentBackend: backendSettings.effectiveBackend,
    routstrProvider: backendSettings.routstrProvider,
    routstrModel: backendSettings.routstrModel,
    starterInstructions: [
      'Start by reading the repository README and the project settings.',
      'Focus on the configured code folder first.',
      'Summarize what to change before editing code.',
    ].join('\n'),
  };
}

function summarizeProjectFolderSettings(project, globalSettings = {}) {
  const settings = getProjectFolderSettings(project, globalSettings);
  const lines = [];
  lines.push(`Main code folder: ${settings.codeFolder || '(not set)'}`);
  lines.push(`Subfolders: ${settings.subfolders.length ? settings.subfolders.join(', ') : '(all files under the code folder)'}`);
  lines.push(`Ignored folders: ${settings.ignoreFolders.length ? settings.ignoreFolders.join(', ') : '(none)'}`);
  if (settings.gettingStarted) {
    lines.push(`Instructions: ${settings.gettingStarted}`);
  }
  return lines.join('\n');
}

module.exports = {
  buildGlobalSettingsWizard,
  buildProjectSettingsWizard,
  getProjectFolderSettings,
  normalizeFolderListField,
  normalizeAgentBackendChoice,
  normalizeProjectBackendSettings,
  normalizeWorkspaceSettings,
  resolveAgentBackendSettings,
  shouldIncludeRecentFile,
  summarizeProjectFolderSettings,
};
