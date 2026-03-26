const express = require('express');
const path = require('path');
const { initDb } = require('./db');
const store = require('./store');
const { routeToAgent } = require('./router');
const { loadPlanningContext } = require('./planning');

initDb();
store.seedDefaults();

const app = express();
const PORT = process.env.PORT || 4080;

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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const planning = loadPlanningContext();
  const projects = store.listProjects().map(decorateProject);
  const agents = store.listAgents();
  const dashboard = computeDashboardStats(projects, agents);

  const projectGroups = {
    general: projects.filter(p => p.section === 'general'),
    pave: projects.filter(p => p.section === 'pave'),
    sec06: projects.filter(p => p.section === 'sec06'),
  };

  const featuredProject = projects.find(p => p.hasActivity) || projects[0] || null;

  res.render('index', {
    projects,
    projectGroups,
    agents,
    dashboard,
    planning,
    featuredProject,
    formatRelativeTime,
  });
});

app.get('/project/:projectId', (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  const activeSession = req.query.session || project.sessions[0]?.id || null;
  const messages = activeSession ? store.listMessages(project.id, activeSession) : [];
  const logs = store.listLogs(project.id, 150);
  const artifacts = store.listArtifacts(project.id, 12);
  const agents = store.listAgents();
  const planning = loadPlanningContext();
  const sidebarProjects = store.listProjects().map(decorateProject);
  const stats = computeProjectStats(project, messages, logs, artifacts, activeSession);
  const currentSession = project.sessions.find(s => s.id === activeSession) || project.sessions[0] || null;

  res.render('project', {
    project,
    activeSession,
    currentSession,
    messages,
    logs,
    artifacts,
    agents,
    planning,
    sidebarProjects,
    stats,
    formatRelativeTime,
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

app.post('/api/agents', (req, res) => {
  const name = `${req.body.name || ''}`.trim();
  const role = `${req.body.role || ''}`.trim();
  const kind = `${req.body.kind || 'echo'}`.trim() || 'echo';

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
    kind: `${req.body.kind || 'planning'}`.trim() || 'planning',
    config: {},
  });
  res.redirect(`/project/${req.params.projectId}`);
});

app.post('/api/project/:projectId/workflows/:workflowId/state', (req, res) => {
  store.updateWorkflowState(req.params.projectId, req.params.workflowId, req.body.state, `set:${req.body.state}`);
  res.redirect(`/project/${req.params.projectId}`);
});

app.post('/api/project/:projectId/message', async (req, res) => {
  const project = store.getProject(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'project_not_found' });

  const sessionId = lastStringField(req.body.session_id, '');
  const workflowId = lastStringField(req.body.workflow_id, '');
  const agentId = lastStringField(req.body.agent_id, '');
  const messageType = lastStringField(req.body.message_type, 'prompt') || 'prompt';
  const priority = lastStringField(req.body.priority, 'normal') || 'normal';

  const session = store.ensureSession(project.id, sessionId, workflowId || null);
  const payload = safeParseJson(req.body.payload_json, { text: `${req.body.text || ''}` });
  const envelope = {
    project_id: project.id,
    session_id: session.id,
    workflow_id: workflowId || null,
    agent_id: agentId || null,
    message_type: messageType,
    priority,
    payload,
  };

  store.appendMessage({
    ...envelope,
    direction: 'outbound',
    content: `${req.body.text || ''}`.trim() || JSON.stringify(envelope.payload),
    status: 'queued',
    error_text: '',
  });

  const agent = store.listAgents().find(a => a.id === envelope.agent_id) || null;

  try {
    const routed = await routeToAgent({ agent, envelope });
    store.appendMessage({
      project_id: project.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      agent_id: envelope.agent_id,
      direction: 'inbound',
      message_type: envelope.message_type,
      priority: envelope.priority,
      payload: routed.toolOutput,
      content: routed.output,
      status: routed.status,
      error_text: routed.error || '',
    });

    store.addLog({
      project_id: project.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      level: routed.status === 'ok' ? 'info' : 'error',
      event_type: 'agent_route',
      message: routed.status === 'ok' ? 'agent reply received' : 'agent routing failed',
      details: { envelope, routed },
    });
  } catch (err) {
    store.appendMessage({
      project_id: project.id,
      session_id: session.id,
      workflow_id: envelope.workflow_id,
      agent_id: envelope.agent_id,
      direction: 'inbound',
      message_type: envelope.message_type,
      priority: envelope.priority,
      payload: { error: String(err) },
      content: '',
      status: 'error',
      error_text: String(err),
    });
  }

  res.redirect(`/project/${project.id}?session=${session.id}`);
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (req.accepts('json')) {
    return res.status(500).json({ error: 'internal_error' });
  }
  return res.status(500).send('Internal server error');
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Ops dashboard running on http://127.0.0.1:${PORT}`);
});
