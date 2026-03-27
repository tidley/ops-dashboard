const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

function renderProjectTemplate(locals) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'src/views/project.ejs'), 'utf8');
  return ejs.render(template, locals, { filename: path.join(__dirname, '..', 'src/views/project.ejs') });
}

describe('project main agent tab', function() {
  it('renders a direct OpenClaw main tab with the main agent selected', function() {
    const html = renderProjectTemplate({
      project: {
        id: 'proj-main-agent',
        name: 'Main Agent Project',
        description: 'Regression test project',
        status: 'active',
        created_at: '2026-03-27T17:00:00.000Z',
        last_activity: '2026-03-27T17:01:00.000Z',
        memory_namespace: 'memory.proj-main-agent',
        workspace_dir: '/tmp/proj-main-agent',
        sessions: [{ id: 'ses-1' }],
        workflows: [],
        agents: [{ id: 'agent-openclaw-main', name: 'OpenClaw Main', kind: 'openclaw', role: 'coordinator' }],
      },
      activeTab: 'main-agent',
      activeSession: 'ses-1',
      currentSession: { id: 'ses-1', title: 'Session 1', state: 'active' },
      messages: [],
      logs: [],
      artifacts: [],
      agents: [{ id: 'agent-openclaw-main', name: 'OpenClaw Main', kind: 'openclaw', role: 'coordinator' }],
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: { recent: [], favourites: [], favorites: [], general: [], pave: [], sec06: [], archived: [] },
      stats: {
        sessionCount: 1,
        workflowCount: 0,
        agentCount: 1,
        messageCount: 0,
        logCount: 0,
        artifactCount: 0,
        activeSession: 'ses-1',
        activeWorkflowCount: 0,
        idleWorkflowCount: 0,
        latestWorkflow: null,
        latestSession: { id: 'ses-1' },
        latestMessage: null,
        latestLog: null,
        workflowStates: {},
        importedFrom: '',
      },
      conversationAgent: { id: 'agent-openclaw-main', name: 'OpenClaw Main', kind: 'openclaw', role: 'coordinator' },
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: ['overview', 'conversations', 'main-agent', 'workflows', 'memory', 'files', 'logs', 'settings'],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: {
        recentArtifacts: [],
      },
    });

    assert.match(html, /data-active-tab="main-agent"/);
    assert.match(html, /OpenClaw Main/);
    assert.match(html, /name="agent_id" value="agent-openclaw-main"/);
  });

  it('renders a project usage chart on the overview tab', function() {
    const html = renderProjectTemplate({
      project: {
        id: 'proj-overview-usage',
        name: 'Overview Usage Project',
        description: 'Regression test project',
        status: 'active',
        created_at: '2026-03-27T17:00:00.000Z',
        last_activity: '2026-03-27T17:01:00.000Z',
        memory_namespace: 'memory.proj-overview-usage',
        workspace_dir: '/tmp/proj-overview-usage',
        sessions: [{ id: 'ses-1' }],
        workflows: [],
        agents: [{ id: 'agent-openclaw-main', name: 'OpenClaw Main', kind: 'openclaw', role: 'coordinator' }],
      },
      activeTab: 'overview',
      activeSession: 'ses-1',
      currentSession: { id: 'ses-1', title: 'Session 1', state: 'active' },
      messages: [],
      logs: [],
      artifacts: [],
      agents: [{ id: 'agent-openclaw-main', name: 'OpenClaw Main', kind: 'openclaw', role: 'coordinator' }],
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: { recent: [], favourites: [], favorites: [], general: [], pave: [], sec06: [], archived: [] },
      stats: {
        sessionCount: 1,
        workflowCount: 0,
        agentCount: 1,
        messageCount: 0,
        logCount: 0,
        artifactCount: 0,
        activeSession: 'ses-1',
        activeWorkflowCount: 0,
        idleWorkflowCount: 0,
        latestWorkflow: null,
        latestSession: { id: 'ses-1' },
        latestMessage: null,
        latestLog: null,
        workflowStates: {},
        importedFrom: '',
      },
      conversationAgent: { id: 'agent-openclaw-main', name: 'OpenClaw Main', kind: 'openclaw', role: 'coordinator' },
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: ['overview', 'conversations', 'main-agent', 'workflows', 'memory', 'files', 'logs', 'settings'],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: {
        recentArtifacts: [],
      },
      projectUsage: {
        todayTotal: 1200,
        weeklyTotal: 3400,
        monthlyTotal: 9200,
        series24h: [0, 120, 300],
        labels24h: ['00:00', '01:00', '02:00'],
        series7d: [10, 20, 30, 40, 50, 60, 70],
        labels7d: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        series30d: Array.from({ length: 30 }, (_, idx) => idx),
        labels30d: Array.from({ length: 30 }, (_, idx) => `D${idx + 1}`),
      },
    });

    assert.match(html, /data-active-tab="overview"/);
    assert.match(html, /Project token use/);
    assert.match(html, /data-usage-panel/);
    assert.match(html, /data-usage-chart/);
    assert.match(html, /data-usage-series-24h/);
    assert.match(html, /home-usage\.js/);
  });
});
