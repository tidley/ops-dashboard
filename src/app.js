const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initDb, db } = require('./db');
const store = require('./store');
const { buildProjectGroups } = require('./sidebar');
const { routeToAgent, routeToCodex } = require('./router');
const { loadPlanningContext } = require('./planning');
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

function decorateProject(project) {
  return {
    ...project,
    sectionLabel: project.section === 'pave' ? 'Pave' : project.section === 'sec06' ? 'sec06' : 'General',
    activityLabel: formatRelativeTime(project.last_activity || project.created_at),
    hasActivity: Boolean(project.last_activity),
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

function clampHourSeriesToNow(series, labels, now = new Date()) {
  const currentHour = now.getUTCHours();
  if (!Array.isArray(series) || !series.length) return { series: [], labels: [] };
  const upperBound = Math.min(series.length, currentHour + 1);
  return {
    series: series.slice(0, upperBound),
    labels: Array.isArray(labels) ? labels.slice(0, upperBound) : [],
  };
}

function buildDashboardUsageStats(projects) {
  const today = new Date();
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dayKeys = buildDateKeys(7, startOfToday);
  const monthKeys = buildDateKeys(30, startOfToday);
  const dayIndex = new Map(dayKeys.map((key, idx) => [key, idx]));
  const monthIndex = new Map(monthKeys.map((key, idx) => [key, idx]));
  const hourLabels = buildHourLabels();
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

      if (dayKey === dayKeys[6]) {
        const hour = time.getUTCHours();
        series24h[hour] += total;
        aggregate24hSeries[hour] += total;
        todayTotal += total;
      }
    }

    const clamped24h = clampHourSeriesToNow(series24h, hourLabels, today);

    projectSummaries.push({
      id: project.id,
      name: project.name,
      weeklyTotal,
      monthlyTotal,
      todayTotal,
      series24h: clamped24h.series,
      series7d,
      series30d,
      dailySeries: series7d,
      hourlySeries: clamped24h.series,
      monthlySeries: series30d,
      labels24h: clamped24h.labels,
      labels7d: dayLabels,
      labels30d: monthLabels,
      lastUsageAt,
    });
  }

  const aggregate24hClamped = clampHourSeriesToNow(aggregate24hSeries, hourLabels, today);

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
    aggregate24hSeries: aggregate24hClamped.series,
    aggregate7dSeries,
    aggregate30dSeries,
    aggregateDailySeries: aggregate7dSeries,
    aggregateHourlySeries: aggregate24hClamped.series,
    projectSummaries,
    aggregateWeeklyTotal: aggregate7dSeries.reduce((sum, value) => sum + value, 0),
    aggregateTodayTotal: aggregate24hClamped.series.reduce((sum, value) => sum + value, 0),
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

function syncProjectUiState(project, tab, sessionId) {
  if (!project) return;
  store.touchProjectState(project.id, {
    last_opened_at: new Date().toISOString(),
    last_tab: tab || 'overview',
    last_session_id: sessionId || '',
  });
}

function resolveProjectRoot(project) {
  return project?.settings_json?.imported_from || project?.workspace_dir || '';
}

function buildDashboardPlanning() {
  return loadPlanningContext({ includeDashboard: true, includePlaybook: true });
}

function buildProjectPlanning(project) {
  return loadPlanningContext({
    projectRoot: resolveProjectRoot(project),
    includeDashboard: false,
    includePlaybook: true,
  });
}

function buildProjectMemorySnapshot(project, activeSession, messages, logs, artifacts) {
  return {
    workspaceDir: resolveProjectRoot(project),
    memoryNamespace: project?.memory_namespace || '',
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
  const projectState = store.ensureProjectState(conversationProject.id);
  const session = store.ensureSession(conversationProject.id, sessionId, workflowId || null);
  const projectConversationAgent = resolveConversationAgent(conversationProject, 'project');
  const mainConversationAgent = resolveConversationAgent(conversationProject, 'main');
  const agentId = requestedAgentId === 'agent-openclaw-main'
    ? (mainConversationAgent?.id || 'agent-openclaw-main')
    : (projectConversationAgent?.id || 'agent-openclaw-main');
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
    agent_session_id: session.id,
    project_state: projectState,
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
    routed = await routeToAgent({ agent, envelope, project: conversationProject, projectState, planning, conversationHistory, projectMemory });
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
      openclaw_session_id: session.id,
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
        location: `/project/${project.id}?session=${session.id}`,
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

  const featuredProject = projects.find(p => p.hasActivity) || projects[0] || null;

  res.render('index', {
    projects,
    projectGroups,
    agents,
    dashboard,
    usage,
    planning,
    featuredProject,
    formatRelativeTime,
  });
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
  const projectState = store.ensureProjectState(project.id);
  project.ui_state = projectState;
  const conversationState = store.ensureProjectState(conversationProject.id);
  const projectUsage = buildDashboardUsageStats([project]).projectSummaries[0] || null;

  const rememberedSession = activeTab === 'main-agent'
    ? (conversationState?.last_session_id || '')
    : (project.ui_state?.last_session_id || '');
  const activeSession = req.query.session || rememberedSession || conversationProject.sessions[0]?.id || null;
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
  const planning = buildProjectPlanning(project);
  const sidebarProjects = store.listProjects().map(decorateProject);
  const projectGroups = buildProjectGroups(sidebarProjects);
  const stats = computeProjectStats(project, messages, logs, artifacts, activeSession);
  const currentSession = conversationProject.sessions.find(s => s.id === activeSession) || conversationProject.sessions[0] || null;
  const conversationAgent = activeTab === 'main-agent'
    ? resolveConversationAgent(conversationProject, 'main')
    : resolveConversationAgent(project, 'project');
  const projectMemory = buildProjectMemorySnapshot(activeTab === 'main-agent' ? conversationProject : project, activeSession, messages, logs, artifacts);
  const codexModel = process.env.CODEX_MODEL || 'gpt-5.3-codex';
  const codexConfigured = Boolean(process.env.OPENAI_API_KEY);

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
    projectUsage,
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

  const favorite = ['1', 'true', 'on', 'yes'].includes(`${req.body.favorite || ''}`.toLowerCase());
  store.setProjectFavorite(req.params.projectId, favorite);

  const returnTo = `${req.body.return_to || ''}`.trim() || req.get('referer') || `/project/${req.params.projectId}`;
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
  app.listen(PORT, LISTEN_HOST, () => {
    console.log(`Ops dashboard running on http://${LISTEN_HOST}:${PORT}`);
  });
}

app.authCookieName = AUTH_COOKIE_NAME;
module.exports = app;
app.processProjectMessage = processProjectMessage;
app.relayAccessController = relayAccessController;
app.buildDashboardUsageStats = buildDashboardUsageStats;
