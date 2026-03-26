const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const { db } = require('./db');

const ROOT_PROJECTS_DIR = path.join(__dirname, '..', 'storage', 'projects');
fs.mkdirSync(ROOT_PROJECTS_DIR, { recursive: true });

function now() { return new Date().toISOString(); }
function parseJson(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }

function classifySectionFromTags(tags = []) {
  if (tags.includes('pave')) return 'pave';
  if (tags.includes('sec06')) return 'sec06';
  return 'general';
}

function upsertImportedProject(input) {
  const existing = db.prepare('SELECT id FROM projects WHERE name=?').get(input.name);
  if (existing) return getProject(existing.id);
  return createProject(input);
}

function importProjectsFromDirectory(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'ops-dashboard');

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
  const c = db.prepare('SELECT COUNT(*) as n FROM agents').get().n;
  if (c === 0) {
    const t = now();
    db.prepare('INSERT INTO agents (id,name,role,kind,config_json,enabled,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('agent-echo', 'Echo Agent', 'operator', 'echo', '{}', 1, t);
  }
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
    JSON.stringify(input.settings || {})
  );

  if (input.agentIds?.length) {
    const stmt = db.prepare('INSERT INTO project_agents (project_id, agent_id, is_default) VALUES (?,?,?)');
    input.agentIds.forEach((agentId, idx) => stmt.run(id, agentId, idx === 0 ? 1 : 0));
  }

  return getProject(id);
}

function listProjects() {
  const rows = db.prepare(`
    SELECT p.*, 
      (SELECT COUNT(*) FROM workflows w WHERE w.project_id = p.id) as workflow_count,
      (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) as session_count,
      (SELECT MAX(created_at) FROM messages m WHERE m.project_id = p.id) as last_activity
    FROM projects p
    ORDER BY p.created_at DESC
  `).all();

  return rows.map(r => { const tags = parseJson(r.tags, []); return ({ ...r, tags, section: classifySectionFromTags(tags), settings_json: parseJson(r.settings_json, {}) }); });
}

function getProject(projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!p) return null;
  p.tags = parseJson(p.tags, []);
  p.settings_json = parseJson(p.settings_json, {});
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
  }
  const id = `ses-${uuid().slice(0, 8)}`;
  const t = now();
  db.prepare('INSERT INTO sessions (id,project_id,workflow_id,title,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, projectId, workflowId || null, 'Operator Session', 'active', t, t);
  return db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
}

function appendMessage(input) {
  const id = `msg-${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO messages (id,project_id,session_id,workflow_id,agent_id,direction,message_type,priority,payload_json,content,status,error_text,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.project_id, input.session_id, input.workflow_id || null, input.agent_id || null,
    input.direction, input.message_type, input.priority, JSON.stringify(input.payload || {}),
    input.content || '', input.status || 'ok', input.error_text || '', now()
  );
  db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(now(), input.session_id);
  return db.prepare('SELECT * FROM messages WHERE id=?').get(id);
}

function listMessages(projectId, sessionId) {
  return db.prepare('SELECT * FROM messages WHERE project_id=? AND session_id=? ORDER BY created_at ASC LIMIT 500').all(projectId, sessionId)
    .map(m => ({ ...m, payload_json: parseJson(m.payload_json, {}) }));
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

module.exports = {
  seedDefaults,
  createProject,
  listProjects,
  getProject,
  listAgents,
  createAgent,
  createWorkflow,
  updateWorkflowState,
  ensureSession,
  appendMessage,
  listMessages,
  addLog,
  listLogs,
  listArtifacts,
  importProjectsFromDirectory
};
