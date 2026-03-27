const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { initDb, db } = require('../src/db');
const store = require('../src/store');

function clearDb() {
  // Clear in order respecting foreign keys
  db.exec('DELETE FROM logs');
  db.exec('DELETE FROM artifacts');
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM workflows');
  db.exec('DELETE FROM project_agents');
  db.exec('DELETE FROM projects');
  db.exec('DELETE FROM agents');
  // Reset autoincrement? Not needed for better-sqlite3 if we insert new rows.
}

beforeEach(() => {
  clearDb();
  store.seedDefaults();
});

describe('createProject', () => {
  test('creates a project with required fields', () => {
    const p = store.createProject({ name: 'test', description: 'desc', tags: ['a','b'] });
    assert.ok(p.id);
    assert.strictEqual(p.name, 'test');
    assert.strictEqual(p.description, 'desc');
    assert.deepStrictEqual(p.tags, ['a','b']);
    assert.strictEqual(p.status, 'active');
    assert.ok(p.workspace_dir);
    assert.ok(p.memory_namespace);
    assert.ok(fs.existsSync(p.workspace_dir));
    assert.ok(fs.existsSync(path.join(p.workspace_dir, 'artifacts')));
    assert.ok(fs.existsSync(path.join(p.workspace_dir, 'logs')));
    assert.ok(fs.existsSync(path.join(p.workspace_dir, 'memory')));
  });

  test('attaches agentIds if provided', () => {
    store.createAgent({ name: 'AgentX', role: 'tester', kind: 'echo' });
    const p = store.createProject({ name: 'projX', agentIds: ['agent-echo'] });
    assert.ok(p.agents.some(a => a.id === 'agent-echo'));
  });
});

describe('getProject', () => {
  test('returns null for unknown id', () => {
    assert.strictEqual(store.getProject('unknown'), null);
  });

  test('populates nested structures correctly', () => {
    store.createAgent({ name: 'Ag1', role: 'r1', kind: 'echo' });
    const p = store.createProject({ name: 'proj', agentIds: ['agent-echo'] });
    store.createWorkflow(p.id, { name: 'wf1', kind: 'planning' });
    store.createWorkflow(p.id, { name: 'wf2', kind: 'coding' });
    const session = store.ensureSession(p.id, null, null);
    store.appendMessage({
      project_id: p.id,
      session_id: session.id,
      direction: 'outbound',
      message_type: 'prompt',
      priority: 'normal',
      payload: { text: 'hello' },
      content: 'hello',
      status: 'ok'
    });
    store.addLog({ project_id: p.id, message: 'log1' });

    const got = store.getProject(p.id);
    assert.strictEqual(got.agents.length, 1);
    assert.strictEqual(got.workflows.length, 2);
    assert.strictEqual(got.sessions.length, 1);
    assert.ok(got.sessions[0].id);
  });
});

describe('listProjects', () => {
  test('returns array with section derived from tags', () => {
    store.createProject({ name: 'pave-child', tags: ['pave'] });
    store.createProject({ name: 'sec06-child', tags: ['sec06'] });
    store.createProject({ name: 'general' });
    const list = store.listProjects();
    const pave = list.find(p => p.name === 'pave-child');
    const sec06 = list.find(p => p.name === 'sec06-child');
    const gen = list.find(p => p.name === 'general');
    assert.strictEqual(pave.section, 'pave');
    assert.strictEqual(sec06.section, 'sec06');
    assert.strictEqual(gen.section, 'general');
  });
});

describe('createAgent', () => {
  test('creates agent with given fields', () => {
    const a = store.createAgent({ name: 'TestAg', role: 'operator', kind: 'echo' });
    assert.ok(a.id);
    assert.strictEqual(a.name, 'TestAg');
    assert.strictEqual(a.role, 'operator');
    assert.strictEqual(a.kind, 'echo');
  });
});

describe('createWorkflow', () => {
  test('creates workflow and attaches to project', () => {
    const p = store.createProject({ name: 'proj' });
    const w = store.createWorkflow(p.id, { name: 'wf', kind: 'coding' });
    assert.ok(w.id);
    assert.strictEqual(w.project_id, p.id);
    assert.strictEqual(w.name, 'wf');
    assert.strictEqual(w.kind, 'coding');
    assert.strictEqual(w.state, 'idle');
  });
});

describe('ensureSession', () => {
  test('creates new session if not exists', () => {
    const p = store.createProject({ name: 'proj' });
    const s = store.ensureSession(p.id, '', null);
    assert.ok(s.id);
    assert.strictEqual(s.project_id, p.id);
    assert.strictEqual(s.state, 'active');
  });

  test('returns existing session if valid', () => {
    const p = store.createProject({ name: 'proj' });
    const s1 = store.ensureSession(p.id, 'custom-ses', null);
    const s2 = store.ensureSession(p.id, 'custom-ses', null);
    assert.strictEqual(s1.id, s2.id);
  });
});

describe('appendMessage', () => {
  test('appends message and increments counts', () => {
    const p = store.createProject({ name: 'proj' });
    const s = store.ensureSession(p.id, null, null);
    const m = store.appendMessage({
      project_id: p.id,
      session_id: s.id,
      direction: 'outbound',
      message_type: 'prompt',
      priority: 'normal',
      payload: { text: 'text' },
      content: 'text',
      status: 'ok'
    });
    assert.ok(m.id);
    assert.strictEqual(m.content, 'text');
    assert.strictEqual(m.direction, 'outbound');
  });
});

describe('listMessages', () => {
  test('returns messages sorted ascending by created_at', () => {
    const p = store.createProject({ name: 'proj' });
    const s = store.ensureSession(p.id, null, null);
    store.appendMessage({
      project_id: p.id,
      session_id: s.id,
      direction: 'outbound',
      message_type: 'prompt',
      priority: 'normal',
      payload: { text: 'first' },
      content: 'first'
    });
    store.appendMessage({
      project_id: p.id,
      session_id: s.id,
      direction: 'outbound',
      message_type: 'prompt',
      priority: 'normal',
      payload: { text: 'second' },
      content: 'second'
    });
    const msgs = store.listMessages(p.id, s.id);
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].content, 'first');
    assert.strictEqual(msgs[1].content, 'second');
  });
});

describe('importProjectsFromDirectory', () => {
  test('imports sec06 children as sec06/<name>', () => {
    const tmp = path.join(__dirname, 'tmp_import_test');
    fs.mkdirSync(tmp, { recursive: true });
    const sec = path.join(tmp, 'sec06');
    fs.mkdirSync(sec);
    fs.mkdirSync(path.join(sec, 'sub1'));
    fs.mkdirSync(path.join(sec, 'sub2'));

    const imported = store.importProjectsFromDirectory(tmp);
    const sub1 = imported.find(p => p.name === 'sec06/sub1');
    const sub2 = imported.find(p => p.name === 'sec06/sub2');
    assert.ok(sub1);
    assert.ok(sub2);
    assert.ok(sub1.tags.includes('sec06'));
    assert.ok(sub2.tags.includes('sec06'));

    fs.rmdirSync(sec, { recursive: true });
    fs.rmdirSync(tmp);
  });

  test('imports pave children as pave/<name>', () => {
    const tmp = path.join(__dirname, 'tmp_import_pave');
    fs.mkdirSync(tmp, { recursive: true });
    const pave = path.join(tmp, 'pave');
    fs.mkdirSync(pave);
    fs.mkdirSync(path.join(pave, 'app1'));

    const imported = store.importProjectsFromDirectory(tmp);
    const app1 = imported.find(p => p.name === 'pave/app1');
    assert.ok(app1);
    assert.ok(app1.tags.includes('pave'));

    fs.rmdirSync(pave, { recursive: true });
    fs.rmdirSync(tmp);
  });
});

console.log('Running store tests...');
