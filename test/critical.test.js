const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const { initDb, db } = require('../src/db');
const store = require('../src/store');
const DB = db;

describe('Critical Paths', function() {
  before(function() {
    initDb();
    store.seedDefaults();
  });

  describe('Project creation', function() {
    it('should create a project with required fields', function() {
      const project = store.createProject({
        name: `test-project-${Date.now()}`,
        description: 'A test project',
        tags: ['test', 'demo'],
      });

      expect(project).to.have.property('id');
      expect(project.tags).to.include('test');
      expect(project.workspace_dir).to.exist;
      expect(project.memory_namespace).to.exist;
    });

    it('should auto-attach default agents if none specified', function() {
      const countBefore = db.prepare('SELECT COUNT(*) as n FROM project_agents').get().n;
      store.createProject({ name: `default-agents-project-${Date.now()}` });
      const countAfter = db.prepare('SELECT COUNT(*) as n FROM project_agents').get().n;
      expect(countAfter).to.be.greaterThan(countBefore);
    });
  });

  describe('Back-fill idempotency', function() {
    it('should not duplicate projects on repeated import', function() {
      const before = store.listProjects().length;
      store.importProjectsFromDirectory('/home/tom/code');
      const after = store.listProjects().length;
      store.importProjectsFromDirectory('/home/tom/code');
      const after2 = store.listProjects().length;

      expect(after).to.be.greaterThanOrEqual(before);
      expect(after2).to.equal(after); // no new rows
    });

    it('should extract sec06 children as separate projects', function() {
      store.importProjectsFromDirectory('/home/tom/code');
      const sec06Projects = store.listProjects().filter(p => p.name.startsWith('sec06/'));
      expect(sec06Projects.length).to.be.greaterThan(0);
    });

    it('should extract pave children as separate projects', function() {
      store.importProjectsFromDirectory('/home/tom/code');
      const paveProjects = store.listProjects().filter(p => p.name.startsWith('pave/'));
      expect(paveProjects.length).to.be.greaterThan(0);
    });
  });

  describe('Workflow state transitions', function() {
    it('should update workflow state and last_event', function() {
      const p = store.createProject({ name: `wf-state-test-${Date.now()}` });
      const wf = store.createWorkflow(p.id, { name: `test-wf-${Date.now()}`, kind: 'planning' });

      store.updateWorkflowState(p.id, wf.id, 'running', 'transition:started');
      const updated = DB.prepare('SELECT * FROM workflows WHERE id=?').get(wf.id);

      expect(updated.state).to.equal('running');
      expect(updated.last_event).to.include('transition:started');
    });
  });

  describe('Session creation', function() {
    it('ensureSession should create a new session if none exists', function() {
      const p = store.createProject({ name: `session-test-${Date.now()}` });
      const session = store.ensureSession(p.id, null, null);

      expect(session).to.have.property('id');
      expect(session.project_id).to.equal(p.id);
      expect(session.state).to.equal('active');
    });

    it('should return existing session when id provided and valid', function() {
      const p = store.createProject({ name: `existing-session-test-${Date.now()}` });
      const first = store.ensureSession(p.id, null, null);
      const second = store.ensureSession(p.id, first.id, null);

      expect(second.id).to.equal(first.id);
    });
  });
});
