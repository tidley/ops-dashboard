const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cookieParser = require('cookie-parser');
const { initDb, db } = require('./db');
const store = require('./store');
const { buildProjectGroups } = require('./sidebar');
const { routeToAgent, routeToCodex } = require('./router');
const {
  createPlanningBundle,
  loadPlanningContext,
  normalizePlanningBundle,
  readPlanningBundle,
  writePlanningBundle,
} = require('./planning');
const {
  collectOpenClawControlPanel,
  normalizeList: normalizeOpenClawList,
  refreshOpenClawControlPanel,
  restartOpenClawGateway,
  setOpenClawDefaultModel,
  setOpenClawFallbackModels,
} = require('./openclaw-control');
const {
  buildGlobalSettingsWizard,
  buildProjectSettingsWizard,
  getProjectFolderSettings,
  resolveAgentBackendSettings,
  normalizeFolderListField,
  shouldIncludeRecentFile,
} = require('./project-settings');
const {
  resolveBackendBaseUrl,
  resolveListenHost,
  resolveListenPort,
} = require('./deployment');
const {
  ACCESS_APP,
  handleBootstrapEvent,
  loadGatewayIdentity,
} = require('./nostr-auth');
const { WebRtcGateway } = require('./webrtc-gateway');
const { NostrRelayAccessController, defaultRelayUrls } = require('./nostr-relay-access');
const {
  AUTH_COOKIE_NAME,
  accessCookieOptions,
  buildAccessCookieValue,
  createRequireAccess,
} = require('./http-auth');

initDb();
store.seedDefaults();

const app = express();
const PORT = resolveListenPort();
const LISTEN_HOST = resolveListenHost();
const BACKEND_BASE_URL = resolveBackendBaseUrl();
const PROJECT_TABS = ['overview', 'conversations', 'main-agent', 'workflows', 'memory', 'files', 'logs', 'settings'];
const gatewayIdentity = loadGatewayIdentity();
const webRtcGateway = new WebRtcGateway({
  store,
  baseUrl: BACKEND_BASE_URL,
});
const relayAccessController = new NostrRelayAccessController({
  store,
  webRtcGateway,
  gatewayIdentity,
  relays: defaultRelayUrls(),
});

function safeParseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeListField(value) {
  if (Array.isArray(value)) return value.map(v => `${v}`.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function lastStringField(value, fallback = '') {
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return `${last ?? fallback}`.trim();
  }
  if (value == null) return fallback;
  return `${value}`.trim();
}

function normalizeProjectTab(value) {
  const tab = lastStringField(value, 'overview').toLowerCase();
  return PROJECT_TABS.includes(tab) ? tab : 'overview';
}

function getGlobalWorkspaceSettings() {
  return store.getAppSetting('global_workspace_settings', {});
}

function getResolvedAgentBackend(project, globalSettings = null) {
  return resolveAgentBackendSettings(project, globalSettings || getGlobalWorkspaceSettings());
}

function formatRelativeTime(iso) {
  if (!iso) return 'No activity yet';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return 'Unknown';
  const diffMs = Date.now() - time;
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  if (absMinutes < 60) return `${absMinutes}m ago`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return `${absHours}h ago`;
  const absDays = Math.round(absHours / 24);
  return `${absDays}d ago`;
}

function formatDateTime(iso) {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decorateProject(project) {
  return {
    ...project,
    sectionLabel: project.section === 'pave' ? 'Pave' : project.section === 'sec06' ? 'sec06' : 'General',
    activityLabel: formatRelativeTime(project.last_activity || project.created_at),
    hasActivity: Boolean(project.last_activity),
  };
}

function serializeSidebarProject(project) {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    sectionLabel: project.sectionLabel,
    activityLabel: project.activityLabel,
    session_count: project.session_count,
    workflow_count: project.workflow_count,
    favorite: Boolean(project.favorite),
    archived: Boolean(project.archived),
  };
}

function computeProjectStats(project, messages, logs, artifacts, activeSession) {
  const workflowStates = project.workflows.reduce((acc, workflow) => {
    acc[workflow.state] = (acc[workflow.state] || 0) + 1;
    return acc;
  }, {});

  return {
    sessionCount: project.sessions.length,
    workflowCount: project.workflows.length,
    agentCount: project.agents.length,
    messageCount: messages.length,
    logCount: logs.length,
    artifactCount: artifacts.length,
    activeSession,
    activeWorkflowCount: project.workflows.filter(w => ['running', 'paused'].includes(w.state)).length,
    idleWorkflowCount: project.workflows.filter(w => w.state === 'idle').length,
    latestWorkflow: project.workflows[0] || null,
    latestSession: project.sessions[0] || null,
    latestMessage: messages[messages.length - 1] || null,
    latestLog: logs[0] || null,
    workflowStates,
    importedFrom: project.settings_json?.imported_from || '',
  };
}

function computeDashboardStats(projects, agents) {
  return {
    projectCount: projects.length,
    activeProjectCount: projects.filter(p => p.hasActivity).length,
    workflowCount: projects.reduce((sum, project) => sum + project.workflow_count, 0),
    sessionCount: projects.reduce((sum, project) => sum + project.session_count, 0),
    agentCount: agents.length,
  };
}

function normalizeUsageValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const input = normalizeUsageValue(raw.input ?? raw.inputTokens ?? raw.promptTokens);
  const output = normalizeUsageValue(raw.output ?? raw.outputTokens);
  const cacheRead = normalizeUsageValue(raw.cacheRead);
  const cacheWrite = normalizeUsageValue(raw.cacheWrite);
  const total = normalizeUsageValue(
    raw.total
    ?? raw.totalTokens
    ?? raw.totalTokensFresh
    ?? (input + output + cacheRead + cacheWrite)
  );

  if (!input && !output && !cacheRead && !cacheWrite && !total) return null;
  return { input, output, cacheRead, cacheWrite, total: total || (input + output + cacheRead + cacheWrite) };
}

function extractUsageFromLogDetails(details) {
  const routed = details?.routed || {};
  const candidates = [
    details?.usage,
    routed?.toolOutput?.response?.meta?.agentMeta?.usage,
    routed?.toolOutput?.response?.meta?.usage,
    routed?.toolOutput?.response?.usage,
    routed?.toolOutput?.usage,
    routed?.usage,
  ];

  for (const candidate of candidates) {
    const usage = normalizeUsage(candidate);
    if (usage) return usage;
  }
  return null;
}

function bucketDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildDateKeys(count, endDate = new Date()) {
  const startOfToday = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  return Array.from({ length: count }, (_, idx) => {
    const date = new Date(startOfToday);
    date.setUTCDate(date.getUTCDate() - (count - 1 - idx));
    return bucketDateKey(date);
  });
}

function formatBucketLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function buildHourLabels() {
  return Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
}

function bucketHourKey(date) {
  const hour = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  ));
  return hour.toISOString();
}

function formatHourBucketLabel(date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function buildRollingHourWindow(count = 24, endDate = new Date()) {
  const endHour = new Date(Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
    endDate.getUTCHours(),
    0,
    0,
    0,
  ));
  endHour.setUTCHours(endHour.getUTCHours() - 1);

  const startHour = new Date(endHour);
  startHour.setUTCHours(startHour.getUTCHours() - (count - 1));

  const keys = [];
  const labels = [];

  for (let idx = 0; idx < count; idx += 1) {
    const hour = new Date(startHour);
    hour.setUTCHours(startHour.getUTCHours() + idx);
    keys.push(bucketHourKey(hour));
    labels.push(formatHourBucketLabel(hour));
  }

  return { keys, labels, startHour, endHour };
}

function buildDashboardUsageStats(projects) {
  const today = new Date();
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayKeys = buildDateKeys(7, startOfToday);
  const monthKeys = buildDateKeys(30, startOfToday);
  const dayIndex = new Map(dayKeys.map((key, idx) => [key, idx]));
  const monthIndex = new Map(monthKeys.map((key, idx) => [key, idx]));
  const hourWindow = buildRollingHourWindow(24, today);
  const hourIndex = new Map(hourWindow.keys.map((key, idx) => [key, idx]));
  const hourLabels = hourWindow.labels;
  const dayLabels = dayKeys.map(formatBucketLabel);
  const monthLabels = monthKeys.map(formatBucketLabel);

  const aggregate24hSeries = Array(24).fill(0);
  const aggregate7dSeries = Array(7).fill(0);
  const aggregate30dSeries = Array(30).fill(0);
  const projectSummaries = [];

  for (const project of projects) {
    const logs = store.listLogs(project.id, 200);
    const series24h = Array(24).fill(0);
    const series7d = Array(7).fill(0);
    const series30d = Array(30).fill(0);
    let weeklyTotal = 0;
    let monthlyTotal = 0;
    let todayTotal = 0;
    let lastUsageAt = '';

    for (const log of logs.slice().reverse()) {
      const usage = extractUsageFromLogDetails(log.details_json || {});
      if (!usage) continue;

      const time = new Date(log.created_at);
      if (Number.isNaN(time.getTime())) continue;

      const total = usage.total;
      const dayKey = bucketDateKey(time);
      const dayIdx = dayIndex.get(dayKey);
      const monthIdx = monthIndex.get(dayKey);

      if (!lastUsageAt || log.created_at > lastUsageAt) {
        lastUsageAt = log.created_at;
      }

      if (dayIdx != null) {
        weeklyTotal += total;
        series7d[dayIdx] += total;
        aggregate7dSeries[dayIdx] += total;
      }

      if (monthIdx != null) {
        monthlyTotal += total;
        series30d[monthIdx] += total;
        aggregate30dSeries[monthIdx] += total;
      }

      const hourIdx = hourIndex.get(bucketHourKey(time));
      if (hourIdx != null) {
        series24h[hourIdx] += total;
        aggregate24hSeries[hourIdx] += total;
      }

      if (dayKey === dayKeys[6]) {
        todayTotal += total;
      }
    }

    projectSummaries.push({
      id: project.id,
      name: project.name,
      weeklyTotal,
      monthlyTotal,
      todayTotal,
      series24h,
      series7d,
      series30d,
      dailySeries: series7d,
      hourlySeries: series24h,
      monthlySeries: series30d,
      labels24h: hourLabels,
      labels7d: dayLabels,
      labels30d: monthLabels,
      lastUsageAt,
    });
  }

  projectSummaries.sort((a, b) => {
    if (b.weeklyTotal !== a.weeklyTotal) return b.weeklyTotal - a.weeklyTotal;
    if (b.todayTotal !== a.todayTotal) return b.todayTotal - a.todayTotal;
    return a.name.localeCompare(b.name);
  });

  return {
    dayKeys,
    monthKeys,
    hourLabels,
    dayLabels,
    monthLabels,
    aggregate24hSeries,
    aggregate7dSeries,
    aggregate30dSeries,
    aggregateDailySeries: aggregate7dSeries,
    aggregateHourlySeries: aggregate24hSeries,
    projectSummaries,
    aggregateWeeklyTotal: aggregate7dSeries.reduce((sum, value) => sum + value, 0),
    aggregateTodayTotal: projectSummaries.reduce((sum, project) => sum + project.todayTotal, 0),
    aggregate30dTotal: aggregate30dSeries.reduce((sum, value) => sum + value, 0),
  };
}

function resolveConversationAgent(project, mode = 'project') {
  const agents = Array.isArray(project?.agents) ? project.agents : [];
  if (mode === 'main') {
    return store.getAgent('agent-openclaw-main')
      || agents.find(a => a.id === 'agent-openclaw-main')
      || agents.find(a => a.kind === 'openclaw' && a.enabled !== 0)
      || agents.find(a => a.is_default && a.enabled !== 0)
      || agents.find(a => a.enabled !== 0)
      || agents[0]
      || null;
  }

  return store.ensureProjectConversationAgent(project.id)
    || agents.find(a => a.kind === 'openclaw' && a.enabled !== 0)
    || agents.find(a => a.is_default && a.enabled !== 0)
    || agents.find(a => a.enabled !== 0)
    || agents[0]
    || null;
}

function resolveConversationProject(project, mode = 'project') {
  if (mode === 'main') {
    return store.ensureOpenClawMainProject() || project;
  }
  return project;
}

function buildConversationThreadSessionId(projectId, sessionId, agentId) {
  const projectPart = `${projectId || 'project'}`.trim();
  const sessionPart = `${sessionId || 'session'}`.trim();
  const agentPart = `${agentId || 'agent'}`.trim();
  return `opsdash:${projectPart}:${sessionPart}:${agentPart}`;
}

function getOpenClawMainAgent() {
  const agents = store.listAgents();
  return agents.find(a => a.id === 'agent-openclaw-main') || agents.find(a => a.kind === 'openclaw' && a.is_default) || null;
}

function syncProjectUiState(project, tab, sessionId) {
  if (!project) return;
  store.touchProjectState(project.id, {
    last_opened_at: new Date().toISOString(),
    last_tab: tab || 'overview',
    last_session_id: sessionId || '',
  });
}

function resolveProjectRoot(project, folderSettings = null) {
  const resolvedFolderSettings = folderSettings || getProjectFolderSettings(project);
  const direct = resolvedFolderSettings.codeFolder || project?.workspace_dir || '';
  if (direct) return direct;

  const description = String(project?.description || '');
  const importedFromMatch = description.match(/Imported from\s+([^\n]+)/i);
  if (importedFromMatch && importedFromMatch[1]) {
    return importedFromMatch[1].trim();
  }

  return '';
}

function resolveProjectBranch(project, folderSettings = null) {
  const root = resolveProjectRoot(project, folderSettings);
  if (!root) return '';

  const commands = [
    `git -C ${JSON.stringify(root)} branch --show-current`,
    `git -C ${JSON.stringify(root)} rev-parse --abbrev-ref HEAD`,
  ];

  for (const command of commands) {
    try {
      const branch = execSync(command, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (branch && branch !== 'HEAD') return branch;
    } catch {
      // try the next fallback
    }
  }

  try {
    const shortHash = execSync(`git -C ${JSON.stringify(root)} rev-parse --short HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (shortHash) return `detached HEAD (${shortHash})`;
  } catch {
    // ignore: not a git repository or no commits yet
  }

  return '';
}

function isPathInsideRoot(root, filePath) {
  if (!root || !filePath) return false;
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}${path.sep}`);
}

function readProjectFileSnapshot(project, relativePath, folderSettings = null) {
  const root = resolveProjectRoot(project, folderSettings);
  if (!root) {
    return { error: 'workspace_root_not_found', statusCode: 404 };
  }

  const safeRelativePath = String(relativePath || '').trim();
  if (!safeRelativePath) {
    return { error: 'file_path_required', statusCode: 400 };
  }

  const absolutePath = path.resolve(root, safeRelativePath);
  if (!isPathInsideRoot(root, absolutePath)) {
    return { error: 'invalid_file_path', statusCode: 400 };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch {
    return { error: 'file_not_found', statusCode: 404 };
  }

  const isBinary = buffer.includes(0);
  const content = isBinary ? '' : buffer.toString('utf8');
  const lineCount = isBinary ? 0 : String(content).replace(/\r\n?/g, '\n').split('\n').length;

  return {
    root,
    absolutePath,
    relativePath: safeRelativePath,
    content,
    isBinary,
    lineCount,
  };
}

function buildFileViewerPage({ project, root, filePath, content, isBinary = false }) {
  const projectName = project?.name || 'Project';
  const safeFilePath = escapeHtml(filePath);
  const safeProjectName = escapeHtml(projectName);
  const safeRoot = escapeHtml(root);
  const lines = isBinary
    ? []
    : String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const lineMarkup = isBinary
    ? `<div class="file-viewer__empty">Binary files cannot be shown in the text viewer.</div>`
    : lines.map((line, index) => {
        const number = index + 1;
        const text = line ? escapeHtml(line) : '&nbsp;';
        return `<div class="file-viewer__line"><span class="file-viewer__line-no">${number}</span><code class="file-viewer__line-code">${text}</code></div>`;
      }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeFilePath} | ${safeProjectName}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1115;
      --bg-2: #171b24;
      --line: #2c3444;
      --line-strong: #3a4357;
      --text: #e6edf3;
      --muted: #94a3b8;
      --accent: #74b4ff;
      --green: #41d36a;
      --red: #ff6a6a;
      --cyan: #4bd8de;
      --mono: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      --sans: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); }
    body { padding: 18px; }
    .file-viewer {
      min-height: calc(100vh - 36px);
      display: grid;
      gap: 14px;
    }
    .file-viewer__header {
      display: grid;
      gap: 6px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(23,27,36,0.95), rgba(16,18,24,0.96));
    }
    .file-viewer__eyebrow {
      color: var(--muted);
      font-size: 0.78rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .file-viewer__title {
      margin: 0;
      font-size: 1.05rem;
      line-height: 1.35;
      word-break: break-word;
    }
    .file-viewer__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 14px;
      color: var(--muted);
      font-size: 0.8rem;
    }
    .file-viewer__meta code {
      font-family: var(--mono);
      color: var(--text);
      font-size: 0.8rem;
    }
    .file-viewer__panel {
      display: grid;
      gap: 0;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      background: var(--bg-2);
    }
    .file-viewer__line {
      display: grid;
      grid-template-columns: 4.5rem minmax(0, 1fr);
      gap: 12px;
      padding: 0 16px;
      min-height: 1.65rem;
      border-top: 1px solid rgba(44,52,68,0.65);
      align-items: start;
      font-family: var(--mono);
      font-size: 0.84rem;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .file-viewer__line:first-child { border-top: 0; }
    .file-viewer__line-no {
      position: sticky;
      left: 0;
      padding: 0.12rem 0;
      color: var(--muted);
      text-align: right;
      user-select: none;
      background: var(--bg-2);
    }
    .file-viewer__line-code {
      display: block;
      padding: 0.12rem 0;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text);
    }
    .file-viewer__empty {
      padding: 18px 16px;
      color: var(--muted);
      font-family: var(--mono);
    }
    @media (max-width: 720px) {
      body { padding: 12px; }
      .file-viewer__line { grid-template-columns: 3.4rem minmax(0, 1fr); padding: 0 12px; }
    }
  </style>
</head>
<body>
  <main class="file-viewer">
    <header class="file-viewer__header">
      <div class="file-viewer__eyebrow">Full file</div>
      <h1 class="file-viewer__title">${safeFilePath}</h1>
      <div class="file-viewer__meta">
        <span>Project <code>${safeProjectName}</code></span>
        <span>Root <code>${safeRoot}</code></span>
        <span>${isBinary ? 'Binary file' : `${lines.length} lines`}</span>
      </div>
    </header>
    <section class="file-viewer__panel" aria-label="File content with line numbers">
      ${lineMarkup}
    </section>
  </main>
</body>
</html>`;
}

function buildPlanningFiles(project, folderSettings = null) {
  const root = resolveProjectRoot(project, folderSettings);
  if (!root) return [];

  const planningRoot = path.join(root, '.planning');
  if (!fs.existsSync(planningRoot)) return [];

  const files = [];
  const stack = [planningRoot];

  while (stack.length) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolutePath);
          return;
        }
        if (!entry.isFile()) return;

        let stat = null;
        try {
          stat = fs.statSync(absolutePath);
        } catch {
          stat = null;
        }

        const repoRelativePath = path.relative(root, absolutePath).split(path.sep).join('/');
        const planningRelativePath = path.relative(planningRoot, absolutePath).split(path.sep).join('/');
        const directory = path.posix.dirname(planningRelativePath);

        files.push({
          file_path: repoRelativePath,
          relative_path: planningRelativePath,
          name: path.basename(absolutePath),
          directory: directory === '.' ? '' : directory,
          updated_at: stat ? stat.mtime.toISOString() : '',
          size_bytes: stat ? stat.size : 0,
        });
      });
  }

  return files.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

function buildRecentFileChanges(project, limit = 10, folderSettings = null) {
  const root = resolveProjectRoot(project, folderSettings);
  if (!root) return [];
  const resolvedFolderSettings = folderSettings || getProjectFolderSettings(project);

  const max = Math.max(1, Number(limit) || 10);
  const items = [];
  const seen = new Set();
  const numstatMap = new Map();

  const recordNumstatLine = (line) => {
    const parts = String(line || '').split('\t');
    if (parts.length < 3) return;
    const added = parts[0] === '-' ? null : Number(parts[0]);
    const removed = parts[1] === '-' ? null : Number(parts[1]);
    const filePath = parts.slice(2).join('\t').trim();
    if (!filePath) return;
    const current = numstatMap.get(filePath) || { added: 0, removed: 0 };
    if (Number.isFinite(added)) current.added += added;
    if (Number.isFinite(removed)) current.removed += removed;
    numstatMap.set(filePath, current);
  };

  try {
    const commands = [
      `git -C ${JSON.stringify(root)} diff --numstat --find-renames -- .`,
      `git -C ${JSON.stringify(root)} diff --cached --numstat --find-renames -- .`,
    ];
    commands.forEach(command => {
      const numstatRaw = execSync(command, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      String(numstatRaw || '')
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .forEach(recordNumstatLine);
    });
  } catch {
    // ignore: repo may not support diff stats
  }

  const statusLabelFor = (status) => {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized.includes('R')) return 'Renamed';
    if (normalized.includes('D')) return 'Deleted';
    if (normalized.includes('A')) return 'Added';
    if (normalized === '??') return 'New';
    return 'Modified';
  };

  const readUpdatedAt = (filePath) => {
    const absPath = path.join(root, filePath);
    try {
      return fs.statSync(absPath).mtime.toISOString();
    } catch {
      // fall through to git history
    }

    try {
      const lastCommit = execSync(`git -C ${JSON.stringify(root)} log -1 --format=%cI -- ${JSON.stringify(filePath)}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return lastCommit || '';
    } catch {
      return '';
    }
  };

  const readDiffPreview = (filePath, status) => {
    const absPath = path.join(root, filePath);
    const sections = [];

    const runDiff = (command) => {
      try {
        return execSync(command, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch (error) {
        return `${error.stdout || ''}`.trim();
      }
    };

    const pushSection = (label, text) => {
      const value = `${text || ''}`.trim();
      if (!value) return;
      sections.push(`## ${label}\n${value}`);
    };

    const isUntracked = String(status || '').trim().toUpperCase() === '??';
    if (isUntracked) {
      pushSection('Untracked file', runDiff(`git -C ${JSON.stringify(root)} diff --no-index --unified=3 --no-color -- /dev/null ${JSON.stringify(absPath)}`));
    } else {
      pushSection('Working tree', runDiff(`git -C ${JSON.stringify(root)} diff --unified=3 --find-renames --no-color -- ${JSON.stringify(filePath)}`));
      pushSection('Staged', runDiff(`git -C ${JSON.stringify(root)} diff --cached --unified=3 --find-renames --no-color -- ${JSON.stringify(filePath)}`));
    }

    const joined = sections.join('\n\n');
    return joined;
  };

  try {
    const statusRaw = execSync(`git -C ${JSON.stringify(root)} status --porcelain=v1 --untracked-files=all`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    String(statusRaw || '')
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .forEach(line => {
        const status = (line.slice(0, 2).trim() || '??').toUpperCase();
        let filePath = line.slice(3).trim();
        if (filePath.includes(' -> ')) {
          filePath = filePath.split(' -> ').pop().trim();
        }
        if (!shouldIncludeRecentFile(filePath, resolvedFolderSettings)) return;
        if (!filePath || seen.has(filePath)) return;
        seen.add(filePath);
        const updatedAt = readUpdatedAt(filePath);
        const stats = numstatMap.get(filePath) || numstatMap.get(`./${filePath}`) || null;
        const summaryParts = [];
        if (stats && Number.isFinite(stats.added)) summaryParts.push(`+${stats.added}`);
        if (stats && Number.isFinite(stats.removed)) summaryParts.push(`-${stats.removed}`);
        const changeDetail = readDiffPreview(filePath, status);
        items.push({
          status,
          status_label: statusLabelFor(status),
          file_path: filePath,
          updated_at: updatedAt,
          change_summary: summaryParts.join(' ') || (status === '??' ? 'new file' : 'worktree change'),
          change_detail: changeDetail,
        });
      });
  } catch {
    // ignore: not a git repo or git unavailable
  }

  return items.slice(0, max);
}

function normalizeRecentFileSortState(value) {
  const defaults = {
    recent: 'desc',
    name: 'asc',
    path: 'asc',
  };

  const raw = typeof value === 'object' && value
    ? {
        key: `${value.key || value.sort || 'recent'}`.trim().toLowerCase(),
        direction: `${value.direction || value.dir || ''}`.trim().toLowerCase(),
      }
    : (() => {
        const text = `${lastStringField(value, 'recent:desc')}`.trim().toLowerCase().replace(/\s+/g, '');
        const parts = text.split(':');
        return {
          key: parts[0] || 'recent',
          direction: parts[1] || '',
        };
      })();

  const key = ['recent', 'name', 'path'].includes(raw.key) ? raw.key : 'recent';
  const direction = raw.direction === 'asc' || raw.direction === 'desc'
    ? raw.direction
    : defaults[key];

  return {
    key,
    direction,
  };
}

function formatRecentFileSortState(value) {
  const state = normalizeRecentFileSortState(value);
  return `${state.key}:${state.direction}`;
}

function sortRecentFileChanges(items, sortMode = 'recent:desc') {
  const sortState = normalizeRecentFileSortState(sortMode);
  const list = Array.isArray(items) ? items.slice() : [];

  const parseDateValue = (value) => {
    const time = new Date(value || '').getTime();
    return Number.isFinite(time) ? time : 0;
  };

  const filePathParts = (filePath) => {
    const value = String(filePath || '').trim();
    const dir = path.dirname(value);
    const base = path.basename(value);
    return {
      dir: dir === '.' ? '' : dir,
      base: base || value,
      full: value,
    };
  };

  const compareByRecent = (a, b) => {
    const aTime = parseDateValue(a.updated_at);
    const bTime = parseDateValue(b.updated_at);
    if (bTime !== aTime) return bTime - aTime;
    return String(a.file_path || '').localeCompare(String(b.file_path || ''));
  };

  const compareByName = (a, b) => {
    const aParts = filePathParts(a.file_path);
    const bParts = filePathParts(b.file_path);
    if (aParts.base !== bParts.base) return aParts.base.localeCompare(bParts.base);
    if (aParts.dir !== bParts.dir) return aParts.dir.localeCompare(bParts.dir);
    return aParts.full.localeCompare(bParts.full);
  };

  const compareByPath = (a, b) => {
    const aParts = filePathParts(a.file_path);
    const bParts = filePathParts(b.file_path);
    if (aParts.dir !== bParts.dir) return aParts.dir.localeCompare(bParts.dir);
    if (aParts.base !== bParts.base) return aParts.base.localeCompare(bParts.base);
    return aParts.full.localeCompare(bParts.full);
  };

  const comparator = sortState.key === 'name'
    ? compareByName
    : sortState.key === 'path'
      ? compareByPath
      : compareByRecent;

  const direction = sortState.direction || (sortState.key === 'recent' ? 'desc' : 'asc');
  const invert = (sortState.key === 'recent' && direction === 'asc') || (sortState.key !== 'recent' && direction === 'desc');

  return list.sort(function(a, b) {
    const result = comparator(a, b);
    return invert ? -result : result;
  });
}

function buildLatestCommitSnapshot(project, limit = 8, folderSettings = null) {
  const root = resolveProjectRoot(project, folderSettings);
  if (!root) return null;
  const resolvedFolderSettings = folderSettings || getProjectFolderSettings(project);
  const max = Math.max(1, Number(limit) || 8);

  let commitHash = '';
  let commitShortHash = '';
  let commitAuthor = '';
  let commitDate = '';
  let commitMessage = '';

  try {
    const metaRaw = execSync(`git -C ${JSON.stringify(root)} log -1 --format=%H%x09%h%x09%an%x09%cI%x09%s`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parts = String(metaRaw || '').split('\t');
    commitHash = parts[0] || '';
    commitShortHash = parts[1] || '';
    commitAuthor = parts[2] || '';
    commitDate = parts[3] || '';
    commitMessage = parts.slice(4).join('\t').trim();
  } catch {
    return null;
  }

  if (!commitHash) return null;

  const statusLabelFor = (status) => {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized.includes('R')) return 'Renamed';
    if (normalized.includes('D')) return 'Deleted';
    if (normalized.includes('A')) return 'Added';
    return 'Modified';
  };

  const readNumstat = (filePath) => {
    try {
      const raw = execSync(`git -C ${JSON.stringify(root)} show --numstat --find-renames --format=format: ${JSON.stringify(commitHash)} -- ${JSON.stringify(filePath)}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const lines = String(raw || '').split('\n').map(line => line.trimEnd()).filter(Boolean);
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const added = parts[0] === '-' ? null : Number(parts[0]);
        const removed = parts[1] === '-' ? null : Number(parts[1]);
        if (Number.isFinite(added) || Number.isFinite(removed)) {
          return {
            added: Number.isFinite(added) ? added : 0,
            removed: Number.isFinite(removed) ? removed : 0,
          };
        }
      }
    } catch {
      // ignore and fall back to no stats
    }
    return null;
  };

  const readDiffPreview = (filePath) => {
    try {
      const raw = execSync(`git -C ${JSON.stringify(root)} show --unified=3 --find-renames --no-color --format=format: ${JSON.stringify(commitHash)} -- ${JSON.stringify(filePath)}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return raw;
    } catch (error) {
      return `${error.stdout || ''}`.trim();
    }
  };

  const files = [];
  try {
    const nameStatusRaw = execSync(`git -C ${JSON.stringify(root)} show --name-status --find-renames --format=format: ${JSON.stringify(commitHash)} --`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    String(nameStatusRaw || '')
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .forEach(line => {
        const parts = line.split('\t');
        if (parts.length < 2) return;
        const status = parts[0].trim();
        const filePath = parts[parts.length - 1].trim();
        if (!filePath || !shouldIncludeRecentFile(filePath, resolvedFolderSettings)) return;

        const stats = readNumstat(filePath);
        const summaryParts = [];
        if (stats && Number.isFinite(stats.added)) summaryParts.push(`+${stats.added}`);
        if (stats && Number.isFinite(stats.removed)) summaryParts.push(`-${stats.removed}`);

        files.push({
          status,
          status_label: statusLabelFor(status),
          file_path: filePath,
          updated_at: commitDate,
          change_summary: summaryParts.join(' ') || 'commit change',
          change_detail: readDiffPreview(filePath),
        });
      });
  } catch {
    // ignore if commit details are unavailable
  }

  return {
    hash: commitHash,
    shortHash: commitShortHash || commitHash.slice(0, 8),
    author: commitAuthor,
    message: commitMessage || 'Latest commit',
    date: commitDate,
    branch: resolveProjectBranch(project, resolvedFolderSettings),
    files: files.slice(0, max),
  };
}

function buildDashboardPlanning() {
  return loadPlanningContext({ includeDashboard: true, includePlaybook: true });
}

function getProjectPlanningDir(project, folderSettings = null) {
  const root = resolveProjectRoot(project, folderSettings);
  return root ? path.join(root, '.planning') : '';
}

function readProjectPlanningBundle(project, folderSettings = null) {
  const planningDir = getProjectPlanningDir(project, folderSettings);
  return readPlanningBundle(planningDir, 'project');
}

function signaturesMatch(a, b) {
  return JSON.stringify(normalizePlanningBundle(a || {})) === JSON.stringify(normalizePlanningBundle(b || {}));
}

function syncProjectPlanningBundle(project, folderSettings = null) {
  const projectState = store.ensureProjectState(project.id);
  const cache = projectState?.ui_cache_json || {};
  const cachedBundle = cache.projectPlanningBundle
    ? normalizePlanningBundle(cache.projectPlanningBundle)
    : null;
  const planningDir = getProjectPlanningDir(project, folderSettings);
  const fileBundle = readProjectPlanningBundle(project, folderSettings);

  if (cachedBundle) {
    if (planningDir && (!fileBundle || !signaturesMatch(fileBundle, cachedBundle))) {
      writePlanningBundle(planningDir, cachedBundle);
    }
    return cachedBundle;
  }

  if (fileBundle) {
    store.updateProjectUiCache(project.id, {
      projectPlanningBundle: fileBundle,
    });
    return fileBundle;
  }

  const emptyBundle = createPlanningBundle('project', planningDir);
  if (planningDir) {
    store.updateProjectUiCache(project.id, {
      projectPlanningBundle: emptyBundle,
    });
  }
  return emptyBundle;
}

function buildProjectPlanning(project, folderSettings = null) {
  const projectBundle = syncProjectPlanningBundle(project, folderSettings);
  return loadPlanningContext({
    projectRoot: resolveProjectRoot(project, folderSettings),
    projectBundle,
    includeDashboard: false,
    includePlaybook: true,
  });
}

function buildProjectUiCacheSnapshot(project, folderSettings = null, options = {}) {
  const recentFileLimit = Math.max(1, Number(options.recentFileLimit) || 25);
  const projectPlanningBundle = syncProjectPlanningBundle(project, folderSettings);
  return {
    workspaceDir: resolveProjectRoot(project, folderSettings),
    workspaceBranch: resolveProjectBranch(project, folderSettings),
    latestCommit: buildLatestCommitSnapshot(project, 6, folderSettings),
    recentFileChanges: buildRecentFileChanges(project, recentFileLimit, folderSettings),
    planningFiles: buildPlanningFiles(project, folderSettings),
    projectPlanningBundle,
  };
}

function getProjectUiCacheSnapshot(project, folderSettings = null, options = {}) {
  const state = store.ensureProjectState(project.id);
  const cache = state?.ui_cache_json || {};
  const hasRecentFiles = Array.isArray(cache.recentFileChanges);
  const hasPlanningFiles = Array.isArray(cache.planningFiles);
  const hasPlanningBundle = Boolean(cache.projectPlanningBundle);
  const hasWorkspace = Object.prototype.hasOwnProperty.call(cache, 'workspaceDir');
  const hasLatestCommit = Object.prototype.hasOwnProperty.call(cache, 'latestCommit');

  if (hasWorkspace && hasRecentFiles && hasPlanningFiles && hasPlanningBundle && hasLatestCommit) {
    return cache;
  }

  const snapshot = {
    ...cache,
    ...buildProjectUiCacheSnapshot(project, folderSettings, options),
  };
  store.updateProjectUiCache(project.id, snapshot);
  return snapshot;
}

function buildProjectMemorySnapshot(project, activeSession, messages, logs, artifacts, folderSettings = null, uiCache = null) {
  const projectSettings = folderSettings || getProjectFolderSettings(project);
  const cache = uiCache || {};
  return {
    workspaceDir: cache.workspaceDir || resolveProjectRoot(project, projectSettings),
    workspaceBranch: cache.workspaceBranch || resolveProjectBranch(project, projectSettings),
    memoryNamespace: project?.memory_namespace || '',
    projectSettings,
    latestCommit: cache.latestCommit || buildLatestCommitSnapshot(project, 6, projectSettings),
    state: project?.ui_state || {},
    recentSessions: (project?.sessions || []).slice(0, 5).map(session => ({
      id: session.id,
      title: session.title,
      state: session.state,
      updated_at: session.updated_at,
    })),
    recentWorkflows: (project?.workflows || []).slice(0, 5).map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      state: workflow.state,
      updated_at: workflow.updated_at,
    })),
    recentMessages: (messages || []).slice(-12).map(message => ({
      id: message.id,
      direction: message.direction,
      message_type: message.message_type,
      content: message.content,
      created_at: message.created_at,
    })),
    recentLogs: (logs || []).slice(0, 8).map(log => ({
      id: log.id,
      level: log.level,
      event_type: log.event_type,
      message: log.message,
      created_at: log.created_at,
    })),
    recentArtifacts: (artifacts || []).slice(0, 8).map(artifact => ({
      id: artifact.id,
      name: artifact.name,
      file_path: artifact.file_path,
      created_at: artifact.created_at,
    })),
    recentFileChanges: Array.isArray(cache.recentFileChanges)
      ? cache.recentFileChanges.slice(0, 8)
      : buildRecentFileChanges(project, 8, projectSettings),
    planningFiles: Array.isArray(cache.planningFiles) ? cache.planningFiles : buildPlanningFiles(project, projectSettings),
    activeSession: activeSession || null,
  };
}

function getOpenClawHistory(project, sessionId) {
  if (sessionId) {
    return store.listMessages(project.id, sessionId);
  }
  return store.listProjectMessages(project.id, 16);
}

async function processProjectMessage({ projectId, body = {}, acceptHeader = '' }) {
  const project = store.getProject(projectId);
  if (!project) {
    return { ok: false, statusCode: 404, kind: 'json', body: { error: 'project_not_found' } };
  }

  const sessionId = lastStringField(body.session_id, '');
  const workflowId = lastStringField(body.workflow_id, '');
  const rawText = `${body.text || ''}`.trim();
  const payload = safeParseJson(body.payload_json, { text: rawText });
  const payloadText = `${payload?.text || payload?.prompt || payload?.task || ''}`.trim();
  if (!rawText && !payloadText) {
    return {
      ok: false,
      statusCode: 400,
      kind: 'json',
      body: { error: 'empty_message', message: 'Message text is required' },
    };
  }
  const requestedAgentId = lastStringField(body.agent_id, '');
  const isMainConversation = requestedAgentId === 'agent-openclaw-main';
  const conversationProject = resolveConversationProject(project, isMainConversation ? 'main' : 'project');
  const agentBackendSettings = isMainConversation ? null : getResolvedAgentBackend(conversationProject);
  const projectState = store.ensureProjectState(conversationProject.id);
  const session = store.ensureSession(conversationProject.id, sessionId, workflowId || null);
  const projectConversationAgent = resolveConversationAgent(conversationProject, 'project');
  const mainConversationAgent = resolveConversationAgent(conversationProject, 'main');
  const agentId = requestedAgentId === 'agent-openclaw-main'
    ? (mainConversationAgent?.id || 'agent-openclaw-main')
    : (projectConversationAgent?.id || 'agent-openclaw-main');
  const agentSessionId = buildConversationThreadSessionId(conversationProject.id, session.id, agentId);
  const messageType = lastStringField(body.message_type, 'prompt') || 'prompt';
  const priority = lastStringField(body.priority, 'normal') || 'normal';

  syncProjectUiState(conversationProject, isMainConversation ? 'main-agent' : 'conversations', session.id);
  const envelope = {
    project_id: conversationProject.id,
    session_id: session.id,
    workflow_id: workflowId || null,
    agent_id: agentId || null,
    message_type: messageType,
    priority,
    payload,
    agent_session_id: agentSessionId,
    project_state: projectState,
    agent_backend: agentBackendSettings.effectiveBackend,
    agent_backend_settings: agentBackendSettings,
  };
  const conversationHistory = getOpenClawHistory(conversationProject, session.id);

  store.appendMessage({
    ...envelope,
    direction: 'outbound',
    content: rawText || JSON.stringify(envelope.payload),
    status: 'queued',
    error_text: '',
  });

  const agent = store.listAgents().find(a => a.id === envelope.agent_id) || null;
  const planning = buildProjectPlanning(conversationProject);
  const projectMemory = buildProjectMemorySnapshot(conversationProject, session.id, store.listProjectMessages(conversationProject.id, 24), store.listLogs(conversationProject.id, 30), store.listArtifacts(conversationProject.id, 12));

  let routed;
  try {
    routed = await routeToAgent({
      agent,
      envelope,
      project: conversationProject,
      projectState,
      planning,
      conversationHistory,
      projectMemory,
      agentBackendSettings,
    });
    store.appendMessage({
      project_id: conversationProject.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      agent_id: envelope.agent_id,
      direction: 'inbound',
      message_type: envelope.message_type,
      priority: envelope.priority,
      payload: routed.toolOutput,
      content: routed.output || routed.error || '(no reply)',
      status: routed.status,
      error_text: routed.error || '',
    });

    store.addLog({
      project_id: conversationProject.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      level: routed.status === 'ok' ? 'info' : 'error',
      event_type: 'agent_route',
      message: routed.status === 'ok' ? 'agent reply received' : 'agent routing failed',
      details: { envelope, routed },
    });

    store.touchProjectState(conversationProject.id, {
      openclaw_session_id: agentSessionId,
      openclaw_memory_json: {
        summary: rawText.slice(0, 240),
        last_user_message: rawText.slice(0, 240),
        last_reply: `${routed.output || routed.error || ''}`.trim().slice(0, 240),
        last_bootstrapped_at: projectState.openclaw_bootstrapped_at || new Date().toISOString(),
        project_root: resolveProjectRoot(conversationProject),
        history_count: conversationHistory.length + 1,
        conversation_agent_id: agentId,
      },
      openclaw_bootstrapped_at: projectState.openclaw_bootstrapped_at || new Date().toISOString(),
      openclaw_last_seen_at: new Date().toISOString(),
    });
  } catch (err) {
    const errorText = String(err);
    store.appendMessage({
      project_id: conversationProject.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      agent_id: envelope.agent_id,
      direction: 'inbound',
      message_type: envelope.message_type,
      priority: envelope.priority,
      payload: { error: errorText },
      content: errorText,
      status: 'error',
      error_text: errorText,
    });
    routed = {
      status: 'error',
      output: errorText,
      error: errorText,
      toolOutput: { error: errorText },
    };
  }

  const responseProject = conversationProject;
  const messages = store.listMessages(responseProject.id, session.id);
  const bodyResponse = {
    success: true,
    session_id: session.id,
    messages,
  };

  const isJson = acceptHeader.includes('application/json') && !acceptHeader.includes('text/html');
  return isJson
    ? { ok: true, kind: 'json', statusCode: 200, body: bodyResponse, session, routed, project }
    : {
        ok: true,
        kind: 'redirect',
        statusCode: 302,
        location: `/project/${project.id}?tab=${isMainConversation ? 'main-agent' : 'conversations'}&session=${session.id}`,
        body: bodyResponse,
        session,
        routed,
        project: responseProject,
      };
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/public/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'nostr-tools', 'lib')));

app.get('/access', (req, res) => {
  res.render('access', {
    gatewayIdentity,
    accessApp: ACCESS_APP,
    defaultRelayUrls: defaultRelayUrls().join(', '),
    stunUrl: process.env.FIPS_STUN_URL || 'stun:fips.tomdwyer.uk:3478',
  });
});

app.use(createRequireAccess({ store }));

app.post('/logout', (req, res) => {
  const sessionId = req.accessSession?.id || '';
  if (sessionId) {
    store.revokeAccessSession(sessionId, 'logout');
    webRtcGateway.closeSession(sessionId, 'logout');
  }
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  return res.redirect(302, '/access');
});

app.get('/', (req, res) => {
  const planning = buildDashboardPlanning();
  const projects = store.listProjects().map(decorateProject);
  const agents = store.listAgents();
  const usage = buildDashboardUsageStats(projects);
  const dashboard = computeDashboardStats(projects, agents);
  const projectGroups = buildProjectGroups(projects);
  const openclawControl = collectOpenClawControlPanel();

  const featuredProject = projects.find(p => p.hasActivity) || projects[0] || null;

  res.render('index', {
    projects,
    projectGroups,
    agents,
    dashboard,
    usage,
    planning,
    featuredProject,
    openclawControl,
    openclawNotice: lastStringField(req.query.openclaw_notice, ''),
    openclawError: lastStringField(req.query.openclaw_error, ''),
    formatRelativeTime,
  });
});

app.get('/api/home/sidebar', (req, res) => {
  const projects = store.listProjects().map(decorateProject);
  const projectGroups = buildProjectGroups(projects);
  const featuredProject = projects.find(p => p.hasActivity) || projects[0] || null;

  res.json({
    ok: true,
    activeProjectId: featuredProject ? featuredProject.id : '',
    sections: {
      recent: projectGroups.recent.map(serializeSidebarProject),
      general: projectGroups.general.map(serializeSidebarProject),
      pave: projectGroups.pave.map(serializeSidebarProject),
      sec06: projectGroups.sec06.map(serializeSidebarProject),
      archived: projectGroups.archived.map(serializeSidebarProject),
    },
  });
});

app.get('/settings', (req, res) => {
  const projects = store.listProjects().map(decorateProject);
  const agents = store.listAgents();
  const dashboard = computeDashboardStats(projects, agents);
  const globalWorkspaceSettings = getGlobalWorkspaceSettings();
  const globalSettingsWizard = buildGlobalSettingsWizard({
    ...globalWorkspaceSettings,
    code_folder: globalWorkspaceSettings.code_folder || globalWorkspaceSettings.codeFolder || path.resolve(__dirname, '..'),
  });
  const globalBackendSettings = getResolvedAgentBackend({ settings_json: globalWorkspaceSettings }, globalWorkspaceSettings);

  res.render('settings', {
    projects,
    agents,
    dashboard,
    globalWorkspaceSettings,
    globalSettingsWizard,
    globalBackendSettings,
    formatRelativeTime,
  });
});

app.get('/api/openclaw/control-panel', async (req, res) => {
  try {
    const snapshot = await refreshOpenClawControlPanel({ force: true });
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ ok: false, error: `${error?.message || error || 'openclaw control refresh failed'}` });
  }
});

app.post('/api/access/bootstrap', (req, res) => {
  const event = req.body?.event || req.body;
  const result = handleBootstrapEvent({ event, gatewayIdentity, metadata: { user_agent: req.get('user-agent') || '' } });
  if (!result.ok) {
    store.recordAccessEvent({
      session_id: `${req.body?.session_id || req.body?.event?.session_id || ''}`,
      pubkey: `${req.body?.pubkey || req.body?.event?.pubkey || ''}`,
      event_type: 'bootstrap_reject',
      detail: result.error,
    });
    return res.status(400).json(result);
  }

  res.cookie(AUTH_COOKIE_NAME, buildAccessCookieValue(result.session.id), accessCookieOptions(req));
  return res.json(result);
});

app.post('/api/access/sessions/:sessionId/confirm', (req, res) => {
  const session = store.getAccessSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'access_session_not_found' });
  const token = `${req.body?.token || ''}`.trim();
  const expected = `${session.metadata_json?.bootstrap_cookie_token || ''}`.trim();
  if (!token || !expected || token !== expected) {
    return res.status(401).json({ error: 'invalid_bootstrap_confirmation' });
  }

  if (session.state !== 'active') {
    return res.status(409).json({ error: 'access_session_inactive' });
  }

  res.cookie(AUTH_COOKIE_NAME, buildAccessCookieValue(session.id), accessCookieOptions(req));
  store.touchAccessSession(session.id, {
    last_seen_at: new Date().toISOString(),
  });
  return res.json({ ok: true, session });
});

app.get('/api/access/sessions/:sessionId', (req, res) => {
  const session = store.getAccessSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'access_session_not_found' });
  return res.json({ session });
});

app.post('/api/access/sessions/:sessionId/signal', async (req, res) => {
  const result = await webRtcGateway.handleSignal(req.params.sessionId, req.body || {});
  if (!result.ok) return res.status(400).json(result);
  return res.json(result);
});

app.post('/api/access/sessions/:sessionId/revoke', (req, res) => {
  const session = store.revokeAccessSession(req.params.sessionId, `${req.body?.reason || 'revoked'}`.trim() || 'revoked');
  webRtcGateway.closeSession(req.params.sessionId, 'revoked');
  if (!session) return res.status(404).json({ error: 'access_session_not_found' });
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  return res.json({ ok: true, session });
});

app.get('/project/:projectId', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');
  const activeTab = normalizeProjectTab(req.query.tab || project.ui_state?.last_tab || 'overview');
  const conversationProject = resolveConversationProject(project, activeTab === 'main-agent' ? 'main' : 'project');
  const globalWorkspaceSettings = getGlobalWorkspaceSettings();
  const projectState = store.ensureProjectState(project.id);
  project.ui_state = projectState;
  const conversationState = store.ensureProjectState(conversationProject.id);
  const projectUsage = buildDashboardUsageStats([project]).projectSummaries[0] || null;

  const rememberedSession = activeTab === 'main-agent'
    ? (conversationState?.last_session_id || '')
    : (project.ui_state?.last_session_id || '');
  const requestedSession = lastStringField(req.query.session, '');
  const requestedSessionExists = requestedSession
    ? conversationProject.sessions.some(s => s.id === requestedSession)
    : false;
  const activeSession = (requestedSessionExists ? requestedSession : '') || rememberedSession || conversationProject.sessions[0]?.id || null;
  const workflowIdFromQuery = lastStringField(req.query.workflow_id, '');
  if (activeTab === 'main-agent') {
    store.touchProjectState(project.id, {
      last_opened_at: new Date().toISOString(),
      last_tab: activeTab,
    });
    store.touchProjectState(conversationProject.id, {
      last_opened_at: new Date().toISOString(),
      last_tab: activeTab,
      last_session_id: activeSession || '',
    });
  } else {
    syncProjectUiState(project, activeTab, activeSession);
  }
  const messages = activeSession ? store.listMessages(conversationProject.id, activeSession) : [];
  const logs = store.listLogs(project.id, 150);
  const artifacts = store.listArtifacts(project.id, 12);
  const agents = store.listAgents();
  const projectFolderSettings = getProjectFolderSettings(project, globalWorkspaceSettings);
  const planning = buildProjectPlanning(project, projectFolderSettings);
  const sidebarProjects = store.listProjects().map(decorateProject);
  const projectGroups = buildProjectGroups(sidebarProjects);
  const stats = computeProjectStats(project, messages, logs, artifacts, activeSession);
  const currentSession = conversationProject.sessions.find(s => s.id === activeSession) || conversationProject.sessions[0] || null;
  const projectBackendSettings = getResolvedAgentBackend(project, globalWorkspaceSettings);
  const conversationAgent = activeTab === 'main-agent'
    ? resolveConversationAgent(conversationProject, 'main')
    : resolveConversationAgent(project, 'project');
  const projectUiCache = getProjectUiCacheSnapshot(project, projectFolderSettings, { recentFileLimit: 25 });
  const projectMemory = buildProjectMemorySnapshot(
    activeTab === 'main-agent' ? conversationProject : project,
    activeSession,
    messages,
    logs,
    artifacts,
    projectFolderSettings,
    projectUiCache,
  );
  const workspaceBranch = projectUiCache.workspaceBranch || resolveProjectBranch(project, projectFolderSettings);
  const recentFileSort = formatRecentFileSortState(req.query.recent_files_sort || 'recent:desc');
  const recentFileChanges = sortRecentFileChanges(
    Array.isArray(projectUiCache.recentFileChanges)
      ? projectUiCache.recentFileChanges
      : buildRecentFileChanges(project, 25, projectFolderSettings),
    recentFileSort,
  );
  const planningFiles = Array.isArray(projectUiCache.planningFiles)
    ? projectUiCache.planningFiles
    : buildPlanningFiles(project, projectFolderSettings);
  projectMemory.recentFileChanges = recentFileChanges;
  projectMemory.planningFiles = planningFiles;
  const projectSettingsWizard = buildProjectSettingsWizard(project, globalWorkspaceSettings);
  const codexModel = process.env.CODEX_MODEL || 'gpt-5.3-codex';
  const codexConfigured = Boolean(process.env.OPENAI_API_KEY);

  // Gather OpenClaw Main agent info for sidebar
  const mainAgent = getOpenClawMainAgent();
  const mainProject = store.ensureOpenClawMainProject();
  const mainStats = mainProject ? computeProjectStats(mainProject, store.listMessages(mainProject.id, 20), store.listLogs(mainProject.id, 50), store.listArtifacts(mainProject.id, 12), null) : null;
  const mainState = mainProject ? store.ensureProjectState(mainProject.id) : null;

  res.render('project', {
    project,
    activeTab,
    activeSession,
    currentSession,
    messages,
    logs,
    artifacts,
    agents,
    planning,
    sidebarProjects,
    projectGroups,
    stats,
    conversationAgent,
    codexModel,
    codexConfigured,
    projectTabs: PROJECT_TABS,
    workflowIdFromQuery,
    formatRelativeTime,
    formatDateTime,
    projectMemory,
    recentFileChanges,
    recentFileSort,
    planningFiles,
    projectUsage,
    projectFolderSettings,
    projectSettingsWizard,
    globalWorkspaceSettings,
    projectBackendSettings,
    workspaceBranch,
    mainAgent,
    mainProject: mainProject || null,
    mainStats: mainStats || null,
    mainState: mainState || null,
  });
});

app.get('/project/:projectId/file', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  const globalWorkspaceSettings = getGlobalWorkspaceSettings();
  const folderSettings = getProjectFolderSettings(project, globalWorkspaceSettings);
  const relativePath = lastStringField(req.query.path || req.query.file_path || '', '');
  const snapshot = readProjectFileSnapshot(project, relativePath, folderSettings);
  if (snapshot.error) {
    if (snapshot.error === 'file_path_required') return res.status(400).send('File path is required');
    if (snapshot.error === 'invalid_file_path') return res.status(400).send('Invalid file path');
    if (snapshot.error === 'workspace_root_not_found') return res.status(404).send('Workspace root not found');
    return res.status(404).send('File not found');
  }

  const viewerHtml = buildFileViewerPage({
    project,
    root: snapshot.root,
    filePath: snapshot.relativePath,
    content: snapshot.content,
    isBinary: snapshot.isBinary,
  });

  res.type('html').send(viewerHtml);
});

app.get('/api/project/:projectId/file-content', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  const globalWorkspaceSettings = getGlobalWorkspaceSettings();
  const folderSettings = getProjectFolderSettings(project, globalWorkspaceSettings);
  const relativePath = lastStringField(req.query.path || req.query.file_path || '', '');
  const snapshot = readProjectFileSnapshot(project, relativePath, folderSettings);

  if (snapshot.error) {
    return res.status(snapshot.statusCode || 400).json({ error: snapshot.error });
  }

  return res.json({
    project_id: project.id,
    file_path: snapshot.relativePath,
    is_binary: snapshot.isBinary,
    line_count: snapshot.lineCount,
    content: snapshot.content,
  });
});

app.post('/api/projects', (req, res) => {
  const name = `${req.body.name || ''}`.trim();
  if (!name) return res.status(400).send('Project name is required');

  const tags = `${req.body.tags || ''}`.split(',').map(s => s.trim()).filter(Boolean);
  const agentIds = normalizeListField(req.body.agentIds);

  const project = store.createProject({
    name,
    description: `${req.body.description || ''}`.trim(),
    tags,
    agentIds,
    settings: {},
  });

  res.redirect(`/project/${project.id}`);
});

app.post('/api/projects/backfill', (req, res) => {
  const imported = store.importProjectsFromDirectory('/home/tom/code');
  res.redirect(`/?imported=${imported.length}`);
});

app.post('/api/projects/:projectId/favorite', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  const body = req.body || {};
  const favorite = ['1', 'true', 'on', 'yes'].includes(`${body.favorite || ''}`.toLowerCase());
  store.setProjectFavorite(req.params.projectId, favorite);

  const returnTo = `${body.return_to || ''}`.trim() || req.get('referer') || `/project/${req.params.projectId}`;
  res.redirect(returnTo);
});

app.post('/api/projects/:projectId/archive', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  const archived = ['1', 'true', 'on', 'yes'].includes(`${req.body.archived || ''}`.toLowerCase());
  store.setProjectArchived(req.params.projectId, archived);

  const returnTo = `${req.body.return_to || ''}`.trim() || req.get('referer') || `/project/${req.params.projectId}`;
  res.redirect(returnTo);
});

app.post('/api/projects/:projectId/settings', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  const codeFolder = `${req.body.code_folder || ''}`.trim();
  const gettingStarted = `${req.body.getting_started || req.body.instructions || ''}`.trim();
  const backendOverride = `${req.body.backend_override || req.body.backendOverride || ''}`.trim() || 'inherit';
  const routstrProvider = `${req.body.routstr_provider || req.body.routstrProvider || ''}`.trim();
  const routstrModel = `${req.body.routstr_model || req.body.routstrModel || ''}`.trim();

  const patch = {
    code_folder: codeFolder,
    getting_started: gettingStarted,
    subfolders: [],
    ignore_folders: [],
    wizard_completed_at: new Date().toISOString(),
    backend_override: backendOverride,
    routstr_provider: routstrProvider,
    routstr_model: routstrModel,
  };

  if (codeFolder) {
    patch.imported_from = codeFolder;
  }

  store.updateProjectSettings(req.params.projectId, patch);

  const returnTo = `${req.body.return_to || ''}`.trim() || `/project/${req.params.projectId}?tab=settings`;
  res.redirect(returnTo);
});

app.post('/api/settings', (req, res) => {
  const codeFolder = `${req.body.code_folder || ''}`.trim();
  const subfolders = normalizeFolderListField(req.body.subfolders || req.body.subfolders_raw || '');
  const ignoreFolders = normalizeFolderListField(req.body.ignore_folders || req.body.ignore_folders_raw || '');
  const gettingStarted = `${req.body.getting_started || req.body.instructions || ''}`.trim();
  const agentBackend = `${req.body.agent_backend || req.body.agentBackend || ''}`.trim() || 'openclaw-proxy';
  const routstrProvider = `${req.body.routstr_provider || req.body.routstrProvider || ''}`.trim();
  const routstrModel = `${req.body.routstr_model || req.body.routstrModel || ''}`.trim();

  store.setAppSetting('global_workspace_settings', {
    code_folder: codeFolder,
    subfolders,
    ignore_folders: ignoreFolders,
    getting_started: gettingStarted,
    wizard_completed_at: new Date().toISOString(),
    agent_backend: agentBackend,
    routstr_provider: routstrProvider,
    routstr_model: routstrModel,
  });

  const returnTo = `${req.body.return_to || ''}`.trim() || '/settings';
  res.redirect(returnTo);
});

app.post('/api/openclaw/gateway/restart', (req, res) => {
  const returnTo = `${req.body.return_to || ''}`.trim() || req.get('referer') || '/';
  try {
    restartOpenClawGateway();
    const next = `${returnTo}${returnTo.includes('?') ? '&' : '?'}openclaw_notice=${encodeURIComponent('Gateway restart requested')}`;
    return res.redirect(302, next);
  } catch (err) {
    const next = `${returnTo}${returnTo.includes('?') ? '&' : '?'}openclaw_error=${encodeURIComponent(String(err.message || err))}`;
    return res.redirect(302, next);
  }
});

app.post('/api/openclaw/models/default', (req, res) => {
  const model = `${req.body.model || ''}`.trim();
  const returnTo = `${req.body.return_to || ''}`.trim() || req.get('referer') || '/';
  if (!model) {
    const next = `${returnTo}${returnTo.includes('?') ? '&' : '?'}openclaw_error=${encodeURIComponent('Model is required')}`;
    return res.redirect(302, next);
  }

  try {
    setOpenClawDefaultModel(model);
    const next = `${returnTo}${returnTo.includes('?') ? '&' : '?'}openclaw_notice=${encodeURIComponent(`Model set to ${model}`)}`;
    return res.redirect(302, next);
  } catch (err) {
    const next = `${returnTo}${returnTo.includes('?') ? '&' : '?'}openclaw_error=${encodeURIComponent(String(err.message || err))}`;
    return res.redirect(302, next);
  }
});

app.post('/api/openclaw/models/fallbacks', (req, res) => {
  const fallbacks = normalizeOpenClawList(req.body.fallbacks || req.body.fallback_models || '');
  const returnTo = `${req.body.return_to || ''}`.trim() || req.get('referer') || '/';
  try {
    setOpenClawFallbackModels(fallbacks);
    const note = fallbacks.length
      ? `Backup models set to ${fallbacks.join(', ')}`
      : 'Backup models cleared';
    const next = `${returnTo}${returnTo.includes('?') ? '&' : '?'}openclaw_notice=${encodeURIComponent(note)}`;
    return res.redirect(302, next);
  } catch (err) {
    const next = `${returnTo}${returnTo.includes('?') ? '&' : '?'}openclaw_error=${encodeURIComponent(String(err.message || err))}`;
    return res.redirect(302, next);
  }
});

app.post('/api/agents', (req, res) => {
  const name = `${req.body.name || ''}`.trim();
  const role = `${req.body.role || ''}`.trim();
  const kind = lastStringField(req.body.kind, 'echo') || 'echo';

  if (!name || !role) return res.status(400).send('Agent name and role are required');

  store.createAgent({
    name,
    role,
    kind,
    config: safeParseJson(req.body.config_json, {}),
    enabled: true,
  });

  res.redirect('/');
});

app.post('/api/project/:projectId/workflows', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  const name = `${req.body.name || ''}`.trim();
  if (!name) return res.status(400).send('Workflow name is required');

  store.createWorkflow(req.params.projectId, {
    name,
    kind: lastStringField(req.body.kind, 'planning') || 'planning',
    config: {},
  });
  res.redirect(`/project/${req.params.projectId}`);
});

app.post('/api/project/:projectId/workflows/:workflowId/state', (req, res) => {
  const state = lastStringField(req.body.state, '');
  if (!state) return res.status(400).send('Workflow state is required');
  store.updateWorkflowState(req.params.projectId, req.params.workflowId, state, `set:${state}`);
  res.redirect(`/project/${req.params.projectId}`);
});

app.post('/api/project/:projectId/message', async (req, res) => {
  const result = await processProjectMessage({
    projectId: req.params.projectId,
    body: req.body || {},
    acceptHeader: `${req.get('accept') || ''}`.toLowerCase(),
  });

  if (!result.ok) {
    return res.status(result.statusCode).json(result.body);
  }

  if (result.kind === 'json') {
    return res.status(result.statusCode).json(result.body);
  }

  return res.redirect(result.statusCode, result.location);
});

app.get('/api/project/:projectId/messages', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  const sessionId = lastStringField(req.query.session_id, '');
  if (!sessionId) return res.status(400).json({ error: 'session_id required' });

  const agentId = lastStringField(req.query.agent_id, '');
  const conversationProject = agentId === 'agent-openclaw-main'
    ? resolveConversationProject(project, 'main')
    : project;
  const session = db.prepare('SELECT * FROM sessions WHERE id=? AND project_id=?').get(sessionId, conversationProject.id);
  if (!session) return res.status(404).json({ error: 'session_not_found' });

  const messages = store.listMessages(conversationProject.id, sessionId);
  res.json({ session_id: sessionId, messages });
});

app.get('/api/project/:projectId/recent-files', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  const tab = normalizeProjectTab(req.query.tab);
  const folderSettings = getProjectFolderSettings(project, getGlobalWorkspaceSettings());
  const recentFileSort = formatRecentFileSortState(req.query.sort || 'recent:desc');
  const files = sortRecentFileChanges(
    buildRecentFileChanges(project, Number(req.query.limit) || 25, folderSettings),
    recentFileSort,
  );
  store.updateProjectUiCache(project.id, {
    workspaceDir: resolveProjectRoot(project, folderSettings),
    workspaceBranch: resolveProjectBranch(project, folderSettings),
    recentFileChanges: files,
  });

  return res.json({
    project_id: project.id,
    tab,
    sort: recentFileSort,
    refreshed_at: new Date().toISOString(),
    files,
  });
});

app.get('/api/project/:projectId/planning-files', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  const folderSettings = getProjectFolderSettings(project, getGlobalWorkspaceSettings());
  const files = buildPlanningFiles(project, folderSettings);
  store.updateProjectUiCache(project.id, {
    workspaceDir: resolveProjectRoot(project, folderSettings),
    planningFiles: files,
  });

  return res.json({
    project_id: project.id,
    refreshed_at: new Date().toISOString(),
    files,
  });
});

app.post('/api/project/:projectId/codex', async (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  const body = req.body || {};
  const sessionId = lastStringField(body.session_id, '');
  const workflowId = lastStringField(body.workflow_id, '');
  const priority = lastStringField(body.priority, 'normal') || 'normal';
  const session = store.ensureSession(project.id, sessionId, workflowId || null);
  syncProjectUiState(project, 'conversations', session.id);
  const payload = safeParseJson(body.payload_json, { text: `${body.text || ''}` });
  const envelope = {
    project_id: project.id,
    session_id: session.id,
    workflow_id: workflowId || null,
    agent_id: null,
    message_type: 'codex',
    priority,
    payload,
  };
  const planning = buildProjectPlanning(project);
  const projectMemory = buildProjectMemorySnapshot(project, session.id, store.listProjectMessages(project.id, 24), store.listLogs(project.id, 30), store.listArtifacts(project.id, 12));
  const codexAgent = {
    id: 'agent-codex-virtual',
    kind: 'codex',
    config_json: JSON.stringify({
      model: lastStringField(req.body.model, process.env.CODEX_MODEL || 'gpt-5.3-codex'),
      reasoning_effort: lastStringField(req.body.reasoning_effort, process.env.CODEX_REASONING_EFFORT || 'medium'),
      prompt_prefix: `${req.body.prompt_prefix || ''}`.trim(),
      prompt_suffix: `${req.body.prompt_suffix || ''}`.trim(),
      max_output_tokens: Number(lastStringField(req.body.max_output_tokens, process.env.CODEX_MAX_OUTPUT_TOKENS || 1200)),
    }),
  };

  store.appendMessage({
    ...envelope,
    direction: 'outbound',
    content: `${body.text || ''}`.trim() || JSON.stringify(envelope.payload),
    status: 'queued',
    error_text: '',
  });

  try {
    const routed = await routeToCodex({ agent: codexAgent, envelope, project, planning, projectMemory });
    store.appendMessage({
      project_id: project.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      agent_id: null,
      direction: 'inbound',
      message_type: 'codex',
      priority: envelope.priority,
      payload: routed.toolOutput,
      content: routed.output || routed.error || '(no reply)',
      status: routed.status,
      error_text: routed.error || '',
    });

    store.addLog({
      project_id: project.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      level: routed.status === 'ok' ? 'info' : 'error',
      event_type: 'codex_route',
      message: routed.status === 'ok' ? 'codex reply received' : 'codex routing failed',
      details: { envelope, routed },
    });
  } catch (err) {
    store.appendMessage({
      project_id: project.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      agent_id: null,
      direction: 'inbound',
      message_type: 'codex',
      priority: envelope.priority,
      payload: { error: String(err) },
      content: String(err),
      status: 'error',
      error_text: String(err),
    });
  }

  res.redirect(`/project/${project.id}?session=${session.id}&tab=conversations`);
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (req.accepts('json')) {
    return res.status(500).json({ error: 'internal_error' });
  }
  return res.status(500).send('Internal server error');
});

if (require.main === module) {
  relayAccessController.start();
  void refreshOpenClawControlPanel().catch(() => {});
  app.listen(PORT, LISTEN_HOST, () => {
    console.log(`Ops dashboard running on http://${LISTEN_HOST}:${PORT}`);
  });
}

app.authCookieName = AUTH_COOKIE_NAME;
module.exports = app;
app.processProjectMessage = processProjectMessage;
app.relayAccessController = relayAccessController;
app.buildDashboardUsageStats = buildDashboardUsageStats;
app.buildRecentFileChanges = buildRecentFileChanges;
app.buildPlanningFiles = buildPlanningFiles;
app.sortRecentFileChanges = sortRecentFileChanges;
app.buildLatestCommitSnapshot = buildLatestCommitSnapshot;
app.readProjectFileSnapshot = readProjectFileSnapshot;
