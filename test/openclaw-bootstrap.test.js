const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('node:child_process');

describe('openclaw project bootstrap', function() {
  let store;
  let routeToOpenClaw;
  let loadPlanningContext;
  let initDb;
  let project;
  let session;
  let projectRoot;
  let runtime;
  let tmpDir;
  let fakeBin;
  let originalExecFile;
  let capturedExec;

  before(function() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-openclaw-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    fakeBin = path.join(tmpDir, 'fake-openclaw');
    process.env.OPENCLAW_BIN = fakeBin;
    originalExecFile = childProcess.execFile;
    childProcess.execFile = (command, args, options, callback) => {
      capturedExec = { command, args, options };
      const sessionIndex = args.indexOf('--session-id');
      const messageIndex = args.indexOf('--message');
      const payload = {
        reply: 'ok',
        captured: {
          sessionId: sessionIndex >= 0 ? (args[sessionIndex + 1] || '') : '',
          message: messageIndex >= 0 ? (args[messageIndex + 1] || '') : '',
          local: args.includes('--local'),
        },
      };
      callback(null, JSON.stringify(payload), '');
    };

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];

    ({ initDb } = require('../src/db'));
    initDb();
    store = require('../src/store');
    store.seedDefaults();
    ({ routeToOpenClaw } = require('../src/router'));
    ({ loadPlanningContext } = require('../src/planning'));

    projectRoot = fs.mkdtempSync(path.join(tmpDir, 'project-root-'));
    const planningDir = path.join(projectRoot, '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    fs.writeFileSync(path.join(planningDir, 'NOW.md'), `# NOW\n\n1. Ship the bootstrap\n- Keep history visible\n`);
    fs.writeFileSync(path.join(planningDir, 'STATUS.md'), `# Status\n\n## Objective\nKeep project history and agent state.\n\n## Current state\n- Waiting for a message\n`);

    project = store.createProject({
      name: `Bootstrap Project ${Date.now()}`,
      description: 'OpenClaw bootstrap regression',
      tags: ['test'],
      settings: { imported_from: projectRoot },
    });
    store.updateProjectSettings(project.id, { imported_from: projectRoot });
    session = store.ensureSession(project.id, null, null);
    store.appendMessage({
      project_id: project.id,
      session_id: session.id,
      direction: 'outbound',
      message_type: 'prompt',
      priority: 'normal',
      payload: { text: 'Earlier request' },
      content: 'Earlier request',
      status: 'ok',
    });
    store.appendMessage({
      project_id: project.id,
      session_id: session.id,
      direction: 'inbound',
      message_type: 'prompt',
      priority: 'normal',
      payload: { text: 'Earlier reply' },
      content: 'Earlier reply',
      status: 'ok',
    });

    runtime = store.ensureProjectState(project.id);
  });

  after(function() {
    if (originalExecFile) childProcess.execFile = originalExecFile;
    delete process.env.OPENCLAW_BIN;
    if (fakeBin && fs.existsSync(fakeBin)) fs.rmSync(fakeBin, { force: true });
    if (projectRoot && fs.existsSync(projectRoot)) fs.rmSync(projectRoot, { recursive: true, force: true });
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bootstraps a project-scoped agent session with prior messages and planning context', async function() {
    const planning = loadPlanningContext({ projectRoot, includeDashboard: false, includePlaybook: true });
    const conversationHistory = store.listProjectMessages(project.id, 10);

    const routed = await routeToOpenClaw({
      agent: {
        id: 'agent-openclaw-main',
        kind: 'openclaw',
        config_json: '{}',
      },
      envelope: {
        project_id: project.id,
        session_id: session.id,
        workflow_id: null,
        agent_id: 'agent-openclaw-main',
        message_type: 'prompt',
        priority: 'normal',
        payload: { text: 'What should I know?' },
        agent_session_id: runtime.openclaw_session_id,
        project_state: runtime,
      },
      project: store.getProject(project.id),
      projectState: runtime,
      planning,
      conversationHistory,
      projectMemory: {
        workspaceDir: projectRoot,
        memoryNamespace: project.memory_namespace,
        state: runtime,
        recentSessions: [session],
        recentWorkflows: [],
        recentMessages: conversationHistory,
        recentLogs: [],
        recentArtifacts: [],
      },
    });

    assert.equal(routed.status, 'ok');
    assert.equal(routed.output, 'ok');
    assert.equal(routed.toolOutput.response.captured.sessionId, runtime.openclaw_session_id);
    assert.equal(capturedExec.command, fakeBin);
    assert.ok(Array.isArray(capturedExec.args));
    assert.match(routed.toolOutput.response.captured.message, /Conversation history/);
    assert.match(routed.toolOutput.response.captured.message, /Earlier request/);
    assert.match(routed.toolOutput.response.captured.message, /Keep project history and agent state/);
    assert.match(routed.toolOutput.response.captured.message, /\[project\] Ship the bootstrap/);
    assert.match(routed.toolOutput.response.captured.message, /Project agent/);
    assert.match(routed.toolOutput.response.captured.message, /Project memory/);
    assert.match(routed.toolOutput.response.captured.message, /Operating procedures/);
    assert.match(routed.toolOutput.response.captured.message, /Reliability-first defaults/);
    assert.doesNotMatch(routed.toolOutput.response.captured.message, /Phase 2 security foundation/);
  });

  it('trims oversized prompts before passing them to the openclaw cli', async function() {
    const planning = loadPlanningContext({ projectRoot, includeDashboard: false, includePlaybook: true });
    const hugeMessages = Array.from({ length: 120 }, (_, index) => ({
      id: `msg-${index}`,
      direction: index % 2 === 0 ? 'outbound' : 'inbound',
      message_type: 'prompt',
      content: `Message ${index} ` + 'x'.repeat(200),
      created_at: `2026-03-27T14:${String(index % 60).padStart(2, '0')}:00.000Z`,
    }));
    const hugeProjectMemory = {
      workspaceDir: projectRoot,
      memoryNamespace: project.memory_namespace,
      state: runtime,
      recentSessions: Array.from({ length: 20 }, (_, index) => ({
        id: `session-${index}`,
        title: `Session ${index}`,
        state: 'active',
        updated_at: `2026-03-27T14:${String(index % 60).padStart(2, '0')}:00.000Z`,
      })),
      recentWorkflows: Array.from({ length: 20 }, (_, index) => ({
        id: `workflow-${index}`,
        name: `Workflow ${index}`,
        state: 'running',
        updated_at: `2026-03-27T14:${String(index % 60).padStart(2, '0')}:00.000Z`,
      })),
      recentMessages: hugeMessages,
      recentLogs: Array.from({ length: 20 }, (_, index) => ({
        id: `log-${index}`,
        level: 'info',
        event_type: 'test',
        message: `Log ${index} ` + 'y'.repeat(200),
        created_at: `2026-03-27T14:${String(index % 60).padStart(2, '0')}:00.000Z`,
      })),
      recentArtifacts: Array.from({ length: 20 }, (_, index) => ({
        id: `artifact-${index}`,
        name: `Artifact ${index}`,
        file_path: `/tmp/artifact-${index}.txt`,
        created_at: `2026-03-27T14:${String(index % 60).padStart(2, '0')}:00.000Z`,
      })),
    };

    const routed = await routeToOpenClaw({
      agent: {
        id: 'agent-openclaw-main',
        kind: 'openclaw',
        config_json: JSON.stringify({ max_prompt_chars: 4000 }),
      },
      envelope: {
        project_id: project.id,
        session_id: session.id,
        workflow_id: null,
        agent_id: 'agent-openclaw-main',
        message_type: 'prompt',
        priority: 'normal',
        payload: { text: 'Please respond with the smallest possible prompt footprint.' },
        agent_session_id: runtime.openclaw_session_id,
        project_state: runtime,
      },
      project: store.getProject(project.id),
      projectState: runtime,
      planning,
      conversationHistory: hugeMessages,
      projectMemory: hugeProjectMemory,
    });

    assert.equal(routed.status, 'ok');
    const messageIndex = capturedExec.args.indexOf('--message');
    assert.ok(messageIndex >= 0, 'expected openclaw cli to receive a message argument');
    assert.equal(capturedExec.args[messageIndex + 1].length <= 4000, true);
    assert.match(capturedExec.args[messageIndex + 1], /Please respond with the smallest possible prompt footprint/);
    assert.match(capturedExec.args[messageIndex + 1], /Truncated context/);
  });

  it('passes a stricter log level to suppress plugin warning noise', async function() {
    const planning = loadPlanningContext({ projectRoot, includeDashboard: false, includePlaybook: true });
    await routeToOpenClaw({
      agent: {
        id: 'agent-openclaw-main',
        kind: 'openclaw',
        config_json: '{}',
      },
      envelope: {
        project_id: project.id,
        session_id: session.id,
        workflow_id: null,
        agent_id: 'agent-openclaw-main',
        message_type: 'prompt',
        priority: 'normal',
        payload: { text: 'Log level check' },
        agent_session_id: runtime.openclaw_session_id,
        project_state: runtime,
      },
      project: store.getProject(project.id),
      projectState: runtime,
      planning,
      conversationHistory: store.listProjectMessages(project.id, 10),
      projectMemory: {
        workspaceDir: projectRoot,
        memoryNamespace: project.memory_namespace,
        state: runtime,
        recentSessions: [session],
        recentWorkflows: [],
        recentMessages: store.listProjectMessages(project.id, 10),
        recentLogs: [],
        recentArtifacts: [],
      },
    });

    const logLevelIndex = capturedExec.args.indexOf('--log-level');
    assert.ok(logLevelIndex >= 0, 'expected log level to be passed to openclaw');
    assert.equal(capturedExec.args[logLevelIndex + 1], 'error');
  });
});
