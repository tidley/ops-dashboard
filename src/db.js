const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'dashboard.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function getTableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name);
}

function ensureColumns(tableName, columns) {
  const existing = new Set(getTableColumns(tableName));
  for (const column of columns) {
    if (existing.has(column.name)) continue;
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.sql}`);
  }
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      memory_namespace TEXT NOT NULL UNIQUE,
      workspace_dir TEXT NOT NULL UNIQUE,
      settings_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_agents (
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, agent_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_state (
      project_id TEXT PRIMARY KEY,
      last_opened_at TEXT NOT NULL,
      last_tab TEXT NOT NULL DEFAULT 'overview',
      last_session_id TEXT DEFAULT '',
      openclaw_session_id TEXT DEFAULT '',
      openclaw_memory_json TEXT NOT NULL DEFAULT '{}',
      openclaw_bootstrapped_at TEXT DEFAULT '',
      openclaw_last_seen_at TEXT DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      config_json TEXT DEFAULT '{}',
      last_event TEXT DEFAULT '',
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workflow_id TEXT,
      title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      workflow_id TEXT,
      agent_id TEXT,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      error_text TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE SET NULL,
      FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      workflow_id TEXT,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text/plain',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      workflow_id TEXT,
      level TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_principals (
      pubkey TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'viewer',
      scope TEXT NOT NULL DEFAULT 'dashboard',
      allowed INTEGER NOT NULL DEFAULT 1,
      revoked_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_sessions (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'dashboard',
      state TEXT NOT NULL DEFAULT 'pending',
      nonce TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT DEFAULT '',
      revoked_at TEXT DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_replay_cache (
      session_id TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      nonce TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY(session_id, pubkey, nonce)
    );

    CREATE TABLE IF NOT EXISTS access_events (
      id TEXT PRIMARY KEY,
      session_id TEXT DEFAULT '',
      pubkey TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  ensureColumns('project_state', [
    { name: 'openclaw_session_id', sql: 'openclaw_session_id TEXT DEFAULT \'\' ' },
    { name: 'openclaw_memory_json', sql: 'openclaw_memory_json TEXT NOT NULL DEFAULT \'{}\'' },
    { name: 'openclaw_bootstrapped_at', sql: 'openclaw_bootstrapped_at TEXT DEFAULT \'\' ' },
    { name: 'openclaw_last_seen_at', sql: 'openclaw_last_seen_at TEXT DEFAULT \'\' ' },
  ]);
}

module.exports = { db, initDb, DATA_DIR };
