const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { db } = require('./db');
const { normalizePlanningBundle, writePlanningBundle } = require('./planning');
const {
  normalizeAccessRole,
  normalizeAccessScope,
  normalizeHexPubkey,
  parseAccessTimestamp,
} = require('./access');

const ROOT_PROJECTS_DIR = path.join(__dirname, '..', 'storage', 'projects');
const OPENCLAW_MAIN_PROJECT_ID = 'proj-openclaw-main';
const DEFAULT_ACCESS_PUBKEYS = [
  {
    pubkey: '2f5759825226f1d57ef1652ba66114b2f938f7f5c50dc505708e5d8b31e4f3c9',
    label: 'Tom access',
    role: 'operator',
    scope: 'dashboard',
  },
];
const DEFAULT_PROJECT_IGNORE_PATTERNS = [
  'wf-state-test-*',
  'prune-test-*',
  'session-test-*',
  'existing-session-test-*',
  'test-project-*',
  'default-agents-project-*',
  'test-wf-*',
];
const PLANNING_WRITE_DEBOUNCE_MS = Math.max(0, Number(process.env.PLANNING_WRITE_DEBOUNCE_MS || 5000) || 0);
const planningMirrorTimers = new Map();

fs.mkdirSync(ROOT_PROJECTS_DIR, { recursive: true });

function now() { return new Date().toISOString(); }
function parseJson(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }

function getProjectPlanningDir(project) {
  const settings = project?.settings_json || {};
  const root = `${settings.code_folder || settings.imported_from || project?.workspace_dir || ''}`.trim();
  return root ? path.join(root, '.planning') : '';
}

function schedulePlanningMirrorWrite(projectId, bundle) {
  const normalized = normalizePlanningBundle(bundle || {});
  const project = getProject(projectId);
  if (!project) return;

  const planningDir = getProjectPlanningDir(project);
  if (!planningDir) return;

  const existing = planningMirrorTimers.get(projectId);
  if (existing) clearTimeout(existing);

  const flush = () => {
    planningMirrorTimers.delete(projectId);
    writePlanningBundle(planningDir, normalized);
  };

  if (PLANNING_WRITE_DEBOUNCE_MS === 0) {
    flush();
    return;
  }

  const timer = setTimeout(flush, PLANNING_WRITE_DEBOUNCE_MS);
  planningMirrorTimers.set(projectId, timer);
}

function getProjectIgnorePath() {
  if (process.env.PROJECT_IGNORE_FILE) {
    return path.resolve(process.env.PROJECT_IGNORE_FILE);
  }
  return path.join(__dirname, '..', '.opsdashboardignore');
}

let projectIgnoreCache = {
  path: '',
  mtimeMs: 0,
  patterns: DEFAULT_PROJECT_IGNORE_PATTERNS.slice(),
};

function globToRegExp(pattern) {
  const escaped = `${pattern || ''}`.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regex}$`);
}

function loadProjectIgnorePatterns() {
  const ignorePath = getProjectIgnorePath();

  if (fs.existsSync(ignorePath)) {
    const stat = fs.statSync(ignorePath);
    if (projectIgnoreCache.path === ignorePath && projectIgnoreCache.mtimeMs === stat.mtimeMs) {
      return projectIgnoreCache.patterns;
    }

    const filePatterns = fs.readFileSync(ignorePath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    projectIgnoreCache = {
      path: ignorePath,
      mtimeMs: stat.mtimeMs,
      patterns: [...DEFAULT_PROJECT_IGNORE_PATTERNS, ...filePatterns],
    };
    return projectIgnoreCache.patterns;
  }

  if (projectIgnoreCache.path === ignorePath && projectIgnoreCache.mtimeMs === 0) {
    return projectIgnoreCache.patterns;
  }

  projectIgnoreCache = {
    path: ignorePath,
    mtimeMs: 0,
    patterns: DEFAULT_PROJECT_IGNORE_PATTERNS.slice(),
  };
  return projectIgnoreCache.patterns;
}

function isIgnoredProjectName(name) {
  const value = `${name || ''}`.trim();
  if (!value) return false;
  return loadProjectIgnorePatterns().some(pattern => globToRegExp(pattern).test(value));
}

function classifySectionFromTags(tags = []) {
  if (tags.includes('pave')) return 'pave';
  if (tags.includes('sec06')) return 'sec06';
  return 'general';
}

function ensureProjectDefaultAgents(projectId) {
  const count = db.prepare('SELECT COUNT(*) as n FROM project_agents WHERE project_id=?').get(projectId)?.n || 0;
  if (count > 0) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_default) VALUES (?,?,?)');
  ['agent-openclaw-main'].forEach((agentId, idx) => stmt.run(projectId, agentId, idx === 0 ? 1 : 0));
}

function ensureOpenClawMainProject() {
  const existing = db.prepare('SELECT * FROM projects WHERE id=?').get(OPENCLAW_MAIN_PROJECT_ID);
  if (existing) {
    const settings = parseJson(existing.settings_json, {});
    if (!settings.hidden) {
      settings.hidden = true;
      db.prepare('UPDATE projects SET settings_json=? WHERE id=?')
        .run(JSON.stringify(settings), OPENCLAW_MAIN_PROJECT_ID);
    }
    ensureProjectDefaultAgents(OPENCLAW_MAIN_PROJECT_ID);
    ensureProjectState(OPENCLAW_MAIN_PROJECT_ID);
    return getProject(OPENCLAW_MAIN_PROJECT_ID);
  }

  const createdAt = now();
  const workspaceDir = path.join(ROOT_PROJECTS_DIR, OPENCLAW_MAIN_PROJECT_ID);
  const memoryNs = `memory.${OPENCLAW_MAIN_PROJECT_ID}`;
  fs.mkdirSync(path.join(workspaceDir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'memory'), { recursive: true });

  db.prepare(`INSERT INTO projects (id,name,description,tags,created_at,status,memory_namespace,workspace_dir,settings_json)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(
    OPENCLAW_MAIN_PROJECT_ID,
    'OpenClaw Main',
    'Global OpenClaw conversation namespace',
    JSON.stringify(['internal', 'openclaw']),
    createdAt,
    'active',
    memoryNs,
    workspaceDir,
    JSON.stringify({ hidden: true }),
  );

  ensureProjectDefaultAgents(OPENCLAW_MAIN_PROJECT_ID);
  ensureProjectState(OPENCLAW_MAIN_PROJECT_ID);
  return getProject(OPENCLAW_MAIN_PROJECT_ID);
}

function getAgent(agentId) {
  if (!agentId) return null;
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  return agent ? { ...agent, config_json: parseJson(agent.config_json, {}) } : null;
}

function buildProjectConversationAgentId(projectId) {
  return `agent-openclaw-project-${projectId}`;
}

function buildProjectConversationAgentName(project) {
  const projectSlug = `${project?.name || project?.id || 'project'}`.trim().slice(0, 24);
  const suffix = `${project?.id || ''}`.trim().slice(-6);
  return `OpenClaw ${projectSlug} ${suffix}`.trim();
}

function ensureProjectConversationAgent(projectId, baseAgentId = 'agent-openclaw-main') {
  const agentId = buildProjectConversationAgentId(projectId);
  const existing = getAgent(agentId);
  if (existing) return existing;

  const project = getProject(projectId);
  if (!project) return null;

  const baseAgent = getAgent(baseAgentId)
    || db.prepare('SELECT * FROM agents WHERE kind=? AND enabled=1 ORDER BY created_at ASC LIMIT 1').get('openclaw');
  const baseConfig = parseJson(baseAgent?.config_json, {
    agent_id: 'main',
    local: true,
    timeout_sec: 90,
    thinking: 'low',
  });

  const t = now();
  const config = {
    ...baseConfig,
    project_id: projectId,
    project_name: project.name,
    conversation_subagent: true,
    conversation_scope: 'project',
    created_from_agent_id: baseAgent?.id || baseAgentId || '',
  };

  db.prepare('INSERT OR IGNORE INTO agents (id,name,role,kind,config_json,enabled,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(
      agentId,
      buildProjectConversationAgentName(project),
      baseAgent?.role || 'conversation',
      baseAgent?.kind || 'openclaw',
      JSON.stringify(config),
      1,
      t,
    );

  db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_default) VALUES (?,?,?)')
    .run(projectId, agentId, 0);

  return getAgent(agentId);
}

function ensureSessionConversationAgent(projectId, sessionId, baseAgentId = 'agent-openclaw-main') {
  const session = `${sessionId || ''}`.trim();
  if (!session) return null;
  return ensureProjectConversationAgent(projectId, baseAgentId);
}

function getProjectState(projectId) {
  const state = db.prepare('SELECT * FROM project_state WHERE project_id=?').get(projectId);
  return state ? {
    ...state,
    last_opened_at: state.last_opened_at || '',
    last_tab: state.last_tab || 'overview',
    last_session_id: state.last_session_id || '',
    openclaw_session_id: state.openclaw_session_id || '',
    openclaw_memory_json: parseJson(state.openclaw_memory_json, {}),
    openclaw_bootstrapped_at: state.openclaw_bootstrapped_at || '',
    openclaw_last_seen_at: state.openclaw_last_seen_at || '',
    ui_cache_json: parseJson(state.ui_cache_json, {}),
    ui_cache_updated_at: state.ui_cache_updated_at || '',
  } : null;
}

function isProjectArchived(projectRow) {
  return Boolean(projectRow?.settings_json?.archived);
}

function touchProjectState(projectId, input = {}) {
  const current = getProjectState(projectId) || {};
  const t = now();
  const lastOpenedAt = input.last_opened_at || t;
  const lastTab = input.last_tab || current.last_tab || 'overview';
  const lastSessionId = Object.prototype.hasOwnProperty.call(input, 'last_session_id')
    ? (input.last_session_id || '')
    : (current.last_session_id || '');
  const openclawSessionId = Object.prototype.hasOwnProperty.call(input, 'openclaw_session_id')
    ? (input.openclaw_session_id || '')
    : (current.openclaw_session_id || '');
  const openclawMemoryJson = Object.prototype.hasOwnProperty.call(input, 'openclaw_memory_json')
    ? JSON.stringify(input.openclaw_memory_json || {})
    : JSON.stringify(current.openclaw_memory_json || {});
  const openclawBootstrappedAt = Object.prototype.hasOwnProperty.call(input, 'openclaw_bootstrapped_at')
    ? (input.openclaw_bootstrapped_at || '')
    : (current.openclaw_bootstrapped_at || '');
  const openclawLastSeenAt = Object.prototype.hasOwnProperty.call(input, 'openclaw_last_seen_at')
    ? (input.openclaw_last_seen_at || '')
    : (current.openclaw_last_seen_at || '');
  const uiCacheJson = Object.prototype.hasOwnProperty.call(input, 'ui_cache_json')
    ? JSON.stringify(input.ui_cache_json || {})
    : JSON.stringify(current.ui_cache_json || {});
  const uiCacheUpdatedAt = Object.prototype.hasOwnProperty.call(input, 'ui_cache_updated_at')
    ? (input.ui_cache_updated_at || '')
    : (current.ui_cache_updated_at || '');

  db.prepare(`
    INSERT INTO project_state (
      project_id, last_opened_at, last_tab, last_session_id,
      openclaw_session_id, openclaw_memory_json, openclaw_bootstrapped_at, openclaw_last_seen_at,
      ui_cache_json, ui_cache_updated_at, updated_at
    )
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET
      last_opened_at=excluded.last_opened_at,
      last_tab=excluded.last_tab,
      last_session_id=excluded.last_session_id,
      openclaw_session_id=excluded.openclaw_session_id,
      openclaw_memory_json=excluded.openclaw_memory_json,
      openclaw_bootstrapped_at=excluded.openclaw_bootstrapped_at,
      openclaw_last_seen_at=excluded.openclaw_last_seen_at,
      ui_cache_json=excluded.ui_cache_json,
      ui_cache_updated_at=excluded.ui_cache_updated_at,
      updated_at=excluded.updated_at
  `).run(
    projectId,
    lastOpenedAt,
    lastTab,
    lastSessionId,
    openclawSessionId,
    openclawMemoryJson,
    openclawBootstrappedAt,
    openclawLastSeenAt,
    uiCacheJson,
    uiCacheUpdatedAt,
    t,
  );

  return getProjectState(projectId);
}

function updateProjectUiCache(projectId, patch = {}) {
  const current = getProjectState(projectId) || {};
  const nextCache = {
    ...(current.ui_cache_json || {}),
    ...(patch || {}),
  };

  if (Object.prototype.hasOwnProperty.call(patch || {}, 'projectPlanningBundle')) {
    schedulePlanningMirrorWrite(projectId, patch.projectPlanningBundle);
  }

  return touchProjectState(projectId, {
    ui_cache_json: nextCache,
    ui_cache_updated_at: now(),
  });
}

function ensureProjectState(projectId) {
  const current = getProjectState(projectId);
  if (current && current.openclaw_session_id) return current;
  const openclawSessionId = current?.openclaw_session_id || `opsdash:${projectId}:openclaw`;
  const t = now();
  return touchProjectState(projectId, {
    openclaw_session_id: openclawSessionId,
    openclaw_memory_json: current?.openclaw_memory_json || {},
    openclaw_bootstrapped_at: current?.openclaw_bootstrapped_at || t,
    openclaw_last_seen_at: current?.openclaw_last_seen_at || t,
  });
}

function upsertImportedProject(input) {
  const existing = db.prepare('SELECT id FROM projects WHERE name=?').get(input.name);
  if (existing) {
    ensureProjectDefaultAgents(existing.id);
    return getProject(existing.id);
  }
  return createProject(input);
}

function importProjectsFromDirectory(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));

  const imported = [];

  for (const e of entries) {
    const name = e.name;
    const abs = path.join(rootDir, name);

    // Pull sec06 children out as distinct projects: sec06/<child>
    if (name === 'sec06') {
      const children = fs.readdirSync(abs, { withFileTypes: true })
        .filter(c => c.isDirectory() && !c.name.startsWith('.'));

      for (const c of children) {
        const childAbs = path.join(abs, c.name);
        const childName = `sec06/${c.name}`;
        const isPave = c.name === 'pave' || c.name.startsWith('pave-') || childAbs.includes('/pave/');
        const tags = ['imported', 'codebase', 'sec06', ...(isPave ? ['pave'] : [])];
        const project = upsertImportedProject({
          name: childName,
          description: `Imported from ${childAbs}`,
          tags,
          settings: { imported_from: childAbs, parent_repo: 'sec06' }
        });
        imported.push(project);
      }
      continue;
    }

    // Pull pave children out as distinct projects: pave/<child>
    if (name === 'pave') {
      const children = fs.readdirSync(abs, { withFileTypes: true })
        .filter(c => c.isDirectory() && !c.name.startsWith('.'));

      for (const c of children) {
        const childAbs = path.join(abs, c.name);
        const childName = `pave/${c.name}`;
        const tags = ['imported', 'codebase', 'pave'];
        const project = upsertImportedProject({
          name: childName,
          description: `Imported from ${childAbs}`,
          tags,
          settings: { imported_from: childAbs, parent_repo: 'pave' }
        });
        imported.push(project);
      }
      continue;
    }

    const isPave = name === 'pave' || name.startsWith('pave-') || abs.includes('/pave/');
    const tags = ['imported', 'codebase', ...(isPave ? ['pave'] : [])];
    const project = upsertImportedProject({
      name,
      description: `Imported from ${abs}`,
      tags,
      settings: { imported_from: abs }
    });
    imported.push(project);
  }

  return imported;
}

function seedDefaults() {
  const t = now();
  const allowedDefaultPubkeys = new Set(DEFAULT_ACCESS_PUBKEYS.map(principal => principal.pubkey));

  // Echo agent is retired: keep disabled if it exists and detach from project defaults.
  db.prepare('UPDATE agents SET enabled=0 WHERE id=?').run('agent-echo');
  db.prepare('DELETE FROM project_agents WHERE agent_id=?').run('agent-echo');

  const openclawAgent = db.prepare('SELECT id FROM agents WHERE id=?').get('agent-openclaw-main');
  if (!openclawAgent) {
    db.prepare('INSERT INTO agents (id,name,role,kind,config_json,enabled,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('agent-openclaw-main', 'OpenClaw Main', 'software engineer', 'openclaw', JSON.stringify({
        agent_id: 'main',
        local: true,
        timeout_sec: 90,
        thinking: 'low'
      }), 1, t);
  } else {
    db.prepare('UPDATE agents SET role=? WHERE id=?').run('software engineer', 'agent-openclaw-main');
  }

  if (process.env.OPENAI_API_KEY) {
    const codex = db.prepare('SELECT id FROM agents WHERE id=?').get('agent-codex');
    if (!codex) {
      db.prepare('INSERT INTO agents (id,name,role,kind,config_json,enabled,created_at) VALUES (?,?,?,?,?,?,?)')
        .run('agent-codex', 'Codex', 'coder', 'codex', JSON.stringify({
          model: process.env.CODEX_MODEL || 'gpt-5.3-codex',
          reasoning_effort: process.env.CODEX_REASONING_EFFORT || 'medium'
        }), 1, t);
    }
  }

  DEFAULT_ACCESS_PUBKEYS.forEach(principal => {
    upsertAccessPrincipal({
      pubkey: principal.pubkey,
      label: principal.label,
      role: principal.role,
      scope: principal.scope,
      allowed: true,
    });
  });

  ensureOpenClawMainProject();

  const allowedPrincipals = db.prepare('SELECT pubkey FROM access_principals WHERE allowed=1').all();
  allowedPrincipals.forEach(({ pubkey }) => {
    if (!allowedDefaultPubkeys.has(pubkey)) {
      revokeAccessPrincipal(pubkey);
    }
  });
}

function createProject(input) {
  const id = `proj-${uuid().slice(0, 8)}`;
  const createdAt = now();
  const workspaceDir = path.join(ROOT_PROJECTS_DIR, id);
  const memoryNs = `memory.${id}`;
  fs.mkdirSync(path.join(workspaceDir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'memory'), { recursive: true });

  db.prepare(`INSERT INTO projects (id,name,description,tags,created_at,status,memory_namespace,workspace_dir,settings_json)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.name,
    input.description || '',
    JSON.stringify(input.tags || []),
    createdAt,
    'active',
    memoryNs,
    workspaceDir,
    JSON.stringify({
      archived: Boolean(input.settings?.archived),
      ...(input.settings || {}),
    })
  );

  const selectedAgentIds = Array.isArray(input.agentIds) && input.agentIds.length
    ? input.agentIds.filter(agentId => agentId !== 'agent-echo')
    : ['agent-openclaw-main'];

  const stmt = db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_default) VALUES (?,?,?)');
  selectedAgentIds.forEach((agentId, idx) => stmt.run(id, agentId, idx === 0 ? 1 : 0));

  return getProject(id);
}

function setProjectFavorite(projectId, favorite) {
  const project = db.prepare('SELECT settings_json FROM projects WHERE id=?').get(projectId);
  if (!project) return null;

  const settings = parseJson(project.settings_json, {});
  settings.favorite = Boolean(favorite);

  db.prepare('UPDATE projects SET settings_json=? WHERE id=?')
    .run(JSON.stringify(settings), projectId);

  return getProject(projectId);
}

function setProjectArchived(projectId, archived) {
  const project = db.prepare('SELECT settings_json FROM projects WHERE id=?').get(projectId);
  if (!project) return null;

  const settings = parseJson(project.settings_json, {});
  settings.archived = Boolean(archived);

  db.prepare('UPDATE projects SET settings_json=? WHERE id=?')
    .run(JSON.stringify(settings), projectId);

  return getProject(projectId);
}

function updateProjectSettings(projectId, patch = {}) {
  const project = db.prepare('SELECT settings_json FROM projects WHERE id=?').get(projectId);
  if (!project) return null;
  const settings = parseJson(project.settings_json, {});
  Object.assign(settings, patch || {});
  db.prepare('UPDATE projects SET settings_json=? WHERE id=?')
    .run(JSON.stringify(settings), projectId);
  return getProject(projectId);
}

function getAppSetting(key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key);
  if (!row) return fallback;
  return parseJson(row.value_json, fallback);
}

function setAppSetting(key, value) {
  const t = now();
  const valueJson = JSON.stringify(value ?? null);
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=excluded.updated_at
  `).run(key, valueJson, t);
  return getAppSetting(key, null);
}

function listProjects() {
  const rows = db.prepare(`
    SELECT p.*,
      ps.last_opened_at,
      ps.last_tab,
      ps.last_session_id,
      (SELECT COUNT(*) FROM workflows w WHERE w.project_id = p.id) as workflow_count,
      (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) as session_count,
      (SELECT MAX(created_at) FROM messages m WHERE m.project_id = p.id) as last_activity
    FROM projects p
    LEFT JOIN project_state ps ON ps.project_id = p.id
  `).all();

  return rows
    .filter(r => !isIgnoredProjectName(r.name))
    .map(r => {
      const tags = parseJson(r.tags, []);
      const settings_json = parseJson(r.settings_json, {});
      if (settings_json.hidden) return null;
      return {
        ...r,
        tags,
        section: classifySectionFromTags(tags),
        settings_json,
        favorite: Boolean(settings_json.favorite),
        archived: Boolean(settings_json.archived),
        ui_state: {
          last_opened_at: r.last_opened_at || '',
          last_tab: r.last_tab || 'overview',
          last_session_id: r.last_session_id || '',
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      const aOpened = new Date(a.ui_state.last_opened_at || a.last_activity || a.created_at || 0).getTime();
      const bOpened = new Date(b.ui_state.last_opened_at || b.last_activity || b.created_at || 0).getTime();
      if (aOpened !== bOpened) return bOpened - aOpened;
      return a.name.localeCompare(b.name);
    });
}

function getProject(projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!p) return null;
  p.tags = parseJson(p.tags, []);
  p.settings_json = parseJson(p.settings_json, {});
  p.favorite = Boolean(p.settings_json.favorite);
  p.archived = Boolean(p.settings_json.archived);
  p.ui_state = getProjectState(projectId) || {
    last_opened_at: '',
    last_tab: 'overview',
    last_session_id: '',
    openclaw_session_id: '',
    openclaw_memory_json: {},
    openclaw_bootstrapped_at: '',
    openclaw_last_seen_at: '',
  };
  p.agents = db.prepare(`SELECT a.*, pa.is_default FROM agents a JOIN project_agents pa ON a.id=pa.agent_id WHERE pa.project_id=?`).all(projectId)
    .map(a => ({ ...a, config_json: parseJson(a.config_json, {}) }));
  p.workflows = db.prepare('SELECT * FROM workflows WHERE project_id=? ORDER BY updated_at DESC').all(projectId)
    .map(w => ({ ...w, config_json: parseJson(w.config_json, {}) }));
  p.sessions = db.prepare('SELECT * FROM sessions WHERE project_id=? ORDER BY updated_at DESC LIMIT 20').all(projectId);
  return p;
}

function listAgents() {
  return db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all().map(a => ({ ...a, config_json: parseJson(a.config_json, {}) }));
}

function createAgent(input) {
  const id = input.id || `agent-${uuid().slice(0, 8)}`;
  db.prepare('INSERT INTO agents (id,name,role,kind,config_json,enabled,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, input.name, input.role, input.kind, JSON.stringify(input.config || {}), input.enabled ? 1 : 0, now());
  return db.prepare('SELECT * FROM agents WHERE id=?').get(id);
}

function createWorkflow(projectId, input) {
  const id = `wf-${uuid().slice(0, 8)}`;
  const t = now();
  db.prepare('INSERT INTO workflows (id,project_id,name,kind,state,config_json,last_event,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, projectId, input.name, input.kind, 'idle', JSON.stringify(input.config || {}), 'created', t, t);
  return db.prepare('SELECT * FROM workflows WHERE id=?').get(id);
}

function updateWorkflowState(projectId, workflowId, state, lastEvent='') {
  db.prepare('UPDATE workflows SET state=?, last_event=?, updated_at=? WHERE id=? AND project_id=?')
    .run(state, lastEvent, now(), workflowId, projectId);
}

function ensureSession(projectId, sessionId, workflowId) {
  if (sessionId) {
    const s = db.prepare('SELECT * FROM sessions WHERE id=? AND project_id=?').get(sessionId, projectId);
    if (s) return s;
    // not found, create with provided id
  } else {
    sessionId = `ses-${uuid().slice(0, 8)}`;
  }

  let id = sessionId;
  const t = now();
  try {
    db.prepare('INSERT INTO sessions (id,project_id,workflow_id,title,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, projectId, workflowId || null, 'Operator Session', 'active', t, t);
  } catch (err) {
    const isSessionIdConflict = `${err?.message || ''}`.includes('sessions.id');
    if (!isSessionIdConflict) throw err;
    id = `ses-${uuid().slice(0, 8)}`;
    db.prepare('INSERT INTO sessions (id,project_id,workflow_id,title,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, projectId, workflowId || null, 'Operator Session', 'active', t, t);
  }
  return db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
}

const PROJECT_MESSAGE_HISTORY_LIMIT = 200;

function pruneProjectMessages(projectId, maxMessages = PROJECT_MESSAGE_HISTORY_LIMIT) {
  db.prepare(`
    DELETE FROM messages
    WHERE id IN (
      SELECT id
      FROM messages
      WHERE project_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT -1 OFFSET ?
    )
  `).run(projectId, maxMessages);
}

function appendMessage(input) {
  const id = `msg-${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO messages (id,project_id,session_id,workflow_id,agent_id,direction,message_type,priority,payload_json,content,status,error_text,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.project_id, input.session_id, input.workflow_id || null, input.agent_id || null,
    input.direction, input.message_type, input.priority, JSON.stringify(input.payload || {}),
    input.content || '', input.status || 'ok', input.error_text || '', now()
  );
  pruneProjectMessages(input.project_id);
  db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(now(), input.session_id);
  return db.prepare('SELECT * FROM messages WHERE id=?').get(id);
}

function listMessages(projectId, sessionId) {
  return db.prepare('SELECT * FROM messages WHERE project_id=? AND session_id=? ORDER BY created_at ASC LIMIT 500').all(projectId, sessionId)
    .map(m => ({ ...m, payload_json: parseJson(m.payload_json, {}) }));
}

function listProjectMessages(projectId, limit = 20) {
  return db.prepare('SELECT * FROM messages WHERE project_id=? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
    .map(m => ({ ...m, payload_json: parseJson(m.payload_json, {}) }))
    .reverse();
}

function addLog(input) {
  db.prepare('INSERT INTO logs (id,project_id,session_id,workflow_id,level,event_type,message,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`log-${uuid().slice(0, 8)}`, input.project_id, input.session_id || null, input.workflow_id || null,
      input.level || 'info', input.event_type || 'event', input.message, JSON.stringify(input.details || {}), now());
}

function listLogs(projectId, limit = 200) {
  return db.prepare('SELECT * FROM logs WHERE project_id=? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
    .map(l => ({ ...l, details_json: parseJson(l.details_json, {}) }));
}

function listArtifacts(projectId, limit = 50) {
  return db.prepare('SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
    .map(a => ({ ...a, metadata_json: parseJson(a.metadata_json, {}) }));
}

function listAccessPrincipals(includeRevoked = false) {
  const rows = includeRevoked
    ? db.prepare('SELECT * FROM access_principals ORDER BY updated_at DESC, created_at DESC').all()
    : db.prepare('SELECT * FROM access_principals WHERE allowed=1 ORDER BY updated_at DESC, created_at DESC').all();

  return rows.map(row => ({
    ...row,
    allowed: Boolean(row.allowed),
    revoked_at: row.revoked_at || '',
  }));
}

function getAccessPrincipal(pubkey) {
  const normalized = normalizeHexPubkey(pubkey);
  if (!normalized) return null;
  const row = db.prepare('SELECT * FROM access_principals WHERE pubkey=?').get(normalized);
  if (!row) return null;
  return {
    ...row,
    allowed: Boolean(row.allowed),
    revoked_at: row.revoked_at || '',
  };
}

function upsertAccessPrincipal(input = {}) {
  const pubkey = normalizeHexPubkey(input.pubkey);
  if (!pubkey) throw new Error('invalid_pubkey');

  const t = now();
  const current = getAccessPrincipal(pubkey) || {};
  const label = Object.prototype.hasOwnProperty.call(input, 'label')
    ? `${input.label || ''}`.trim()
    : (current.label || '');
  const role = normalizeAccessRole(Object.prototype.hasOwnProperty.call(input, 'role') ? input.role : current.role);
  const scope = normalizeAccessScope(Object.prototype.hasOwnProperty.call(input, 'scope') ? input.scope : current.scope);
  const allowed = Object.prototype.hasOwnProperty.call(input, 'allowed')
    ? (input.allowed ? 1 : 0)
    : (current && Object.prototype.hasOwnProperty.call(current, 'pubkey') ? (current.allowed ? 1 : 0) : 1);
  const revokedAt = allowed ? '' : (current.revoked_at || t);

  db.prepare(`
    INSERT INTO access_principals (pubkey,label,role,scope,allowed,revoked_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(pubkey) DO UPDATE SET
      label=excluded.label,
      role=excluded.role,
      scope=excluded.scope,
      allowed=excluded.allowed,
      revoked_at=excluded.revoked_at,
      updated_at=excluded.updated_at
  `).run(pubkey, label, role, scope, allowed, revokedAt, current.created_at || t, t);

  return getAccessPrincipal(pubkey);
}

function revokeAccessPrincipal(pubkey) {
  const normalized = normalizeHexPubkey(pubkey);
  if (!normalized) return null;
  const current = getAccessPrincipal(normalized);
  if (!current) return null;
  const t = now();
  db.prepare(`
    UPDATE access_principals
    SET allowed=0, revoked_at=?, updated_at=?
    WHERE pubkey=?
  `).run(t, t, normalized);
  return getAccessPrincipal(normalized);
}

function isAccessAllowed(pubkey) {
  const principal = getAccessPrincipal(pubkey);
  return Boolean(principal && principal.allowed);
}

function listAccessSessions(pubkey = '') {
  const normalized = normalizeHexPubkey(pubkey);
  const rows = normalized
    ? db.prepare('SELECT * FROM access_sessions WHERE pubkey=? ORDER BY updated_at DESC, created_at DESC').all(normalized)
    : db.prepare('SELECT * FROM access_sessions ORDER BY updated_at DESC, created_at DESC').all();

  return rows.map(row => ({
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
    last_seen_at: row.last_seen_at || '',
    revoked_at: row.revoked_at || '',
  }));
}

function getAccessSession(sessionId) {
  const row = db.prepare('SELECT * FROM access_sessions WHERE id=?').get(sessionId);
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
    last_seen_at: row.last_seen_at || '',
    revoked_at: row.revoked_at || '',
  };
}

function issueAccessSession(input = {}) {
  const pubkey = normalizeHexPubkey(input.pubkey);
  if (!pubkey) throw new Error('invalid_pubkey');
  if (!isAccessAllowed(pubkey)) throw new Error('pubkey_not_allowed');

  const sessionId = `${input.session_id || `acc-${uuid().slice(0, 8)}`}`;
  const nonce = `${input.nonce || uuid().replace(/-/g, '')}`.trim();
  if (!nonce) throw new Error('missing_nonce');
  const scope = normalizeAccessScope(input.scope);
  const issuedAt = `${input.issued_at || now()}`;
  const expiresAt = `${input.expires_at || ''}`.trim();
  if (!parseAccessTimestamp(issuedAt) || !parseAccessTimestamp(expiresAt)) throw new Error('invalid_access_window');
  const state = `${input.state || 'pending'}`.trim() || 'pending';
  const t = now();
  const metadataJson = JSON.stringify(input.metadata || {});

  db.prepare(`
    INSERT INTO access_sessions (
      id,pubkey,scope,state,nonce,issued_at,expires_at,last_seen_at,revoked_at,metadata_json,created_at,updated_at
    )
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      pubkey=excluded.pubkey,
      scope=excluded.scope,
      state=excluded.state,
      nonce=excluded.nonce,
      issued_at=excluded.issued_at,
      expires_at=excluded.expires_at,
      metadata_json=excluded.metadata_json,
      updated_at=excluded.updated_at
  `).run(
    sessionId,
    pubkey,
    scope,
    state,
    nonce,
    issuedAt,
    expiresAt,
    '',
    '',
    metadataJson,
    t,
    t,
  );

  return getAccessSession(sessionId);
}

function touchAccessSession(sessionId, patch = {}) {
  const current = getAccessSession(sessionId);
  if (!current) return null;
  const t = now();
  const lastSeenAt = Object.prototype.hasOwnProperty.call(patch, 'last_seen_at')
    ? `${patch.last_seen_at || ''}`
    : (current.last_seen_at || '');
  const state = Object.prototype.hasOwnProperty.call(patch, 'state')
    ? `${patch.state || ''}`.trim() || current.state
    : current.state;
  const revokedAt = Object.prototype.hasOwnProperty.call(patch, 'revoked_at')
    ? `${patch.revoked_at || ''}`
    : (current.revoked_at || '');
  const expiresAt = Object.prototype.hasOwnProperty.call(patch, 'expires_at')
    ? `${patch.expires_at || ''}`
    : (current.expires_at || '');
  const metadata = Object.prototype.hasOwnProperty.call(patch, 'metadata')
    ? JSON.stringify(patch.metadata || {})
    : JSON.stringify(current.metadata_json || {});

  db.prepare(`
    UPDATE access_sessions
    SET state=?, expires_at=?, last_seen_at=?, revoked_at=?, metadata_json=?, updated_at=?
    WHERE id=?
  `).run(state, expiresAt, lastSeenAt, revokedAt, metadata, t, sessionId);

  return getAccessSession(sessionId);
}

function revokeAccessSession(sessionId, reason = '') {
  const current = getAccessSession(sessionId);
  if (!current) return null;
  const t = now();
  db.prepare(`
    UPDATE access_sessions
    SET state='revoked', revoked_at=?, updated_at=?, metadata_json=?
    WHERE id=?
  `).run(t, t, JSON.stringify({ ...(current.metadata_json || {}), revoked_reason: reason || 'revoked' }), sessionId);
  return getAccessSession(sessionId);
}

function rememberAccessReplay(input = {}) {
  const sessionId = `${input.session_id || ''}`.trim();
  const pubkey = normalizeHexPubkey(input.pubkey);
  const nonce = `${input.nonce || ''}`.trim();
  if (!sessionId || !pubkey || !nonce) throw new Error('invalid_replay_tuple');
  const seenAt = `${input.seen_at || now()}`;
  const result = db.prepare(`
    INSERT OR IGNORE INTO access_replay_cache (session_id,pubkey,nonce,seen_at)
    VALUES (?,?,?,?)
  `).run(sessionId, pubkey, nonce, seenAt);
  return result.changes > 0;
}

function hasAccessReplay(input = {}) {
  const sessionId = `${input.session_id || ''}`.trim();
  const pubkey = normalizeHexPubkey(input.pubkey);
  const nonce = `${input.nonce || ''}`.trim();
  if (!sessionId || !pubkey || !nonce) return false;
  const row = db.prepare('SELECT 1 FROM access_replay_cache WHERE session_id=? AND pubkey=? AND nonce=?').get(sessionId, pubkey, nonce);
  return Boolean(row);
}

function recordAccessEvent(input = {}) {
  const pubkey = normalizeHexPubkey(input.pubkey);
  if (!pubkey) throw new Error('invalid_pubkey');
  const sessionId = `${input.session_id || ''}`.trim();
  const t = now();
  db.prepare('INSERT INTO access_events (id,session_id,pubkey,event_type,detail,created_at) VALUES (?,?,?,?,?,?)')
    .run(`evt-${uuid().slice(0, 8)}`, sessionId, pubkey, `${input.event_type || 'event'}`, `${input.detail || ''}`, t);
}

function listAccessEvents(pubkey = '', limit = 100) {
  const normalized = normalizeHexPubkey(pubkey);
  const rows = normalized
    ? db.prepare('SELECT * FROM access_events WHERE pubkey=? ORDER BY created_at DESC LIMIT ?').all(normalized, limit)
    : db.prepare('SELECT * FROM access_events ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows;
}

module.exports = {
  seedDefaults,
  createProject,
  listProjects,
  getProject,
  listAgents,
  getAgent,
  ensureSessionConversationAgent,
  ensureProjectConversationAgent,
  ensureOpenClawMainProject,
  createAgent,
  createWorkflow,
  updateWorkflowState,
  ensureSession,
  appendMessage,
  listMessages,
  addLog,
  listLogs,
  listArtifacts,
  listAccessPrincipals,
  getAccessPrincipal,
  upsertAccessPrincipal,
  revokeAccessPrincipal,
  isAccessAllowed,
  listAccessSessions,
  getAccessSession,
  issueAccessSession,
  touchAccessSession,
  revokeAccessSession,
  rememberAccessReplay,
  hasAccessReplay,
  recordAccessEvent,
  listAccessEvents,
  getProjectState,
  touchProjectState,
  updateProjectUiCache,
  updateProjectSettings,
  getAppSetting,
  setProjectFavorite,
  setProjectArchived,
  setAppSetting,
  importProjectsFromDirectory,
  ensureProjectState,
  listProjectMessages,
  isIgnoredProjectName,
  loadProjectIgnorePatterns,
};
