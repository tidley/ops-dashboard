const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

function renderProjectTemplate(locals) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'src/views/project.ejs'), 'utf8');
  return ejs.render(template, locals, { filename: path.join(__dirname, '..', 'src/views/project.ejs') });
}

describe('project main agent tab', function() {
  it('renders a direct OpenClaw main tab with the main agent selected', function () {
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
        agents: [
          {
            id: 'agent-openclaw-main',
            name: 'OpenClaw Main',
            kind: 'openclaw',
            role: 'software engineer',
          },
        ],
      },
      activeTab: 'main-agent',
      activeSession: 'ses-1',
      currentSession: { id: 'ses-1', title: 'Session 1', state: 'active' },
      messages: [],
      logs: [],
      artifacts: [],
      agents: [
        {
          id: 'agent-openclaw-main',
          name: 'OpenClaw Main',
          kind: 'openclaw',
          role: 'software engineer',
        },
      ],
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: {
        recent: [],
        favourites: [],
        favorites: [],
        general: [],
        pave: [],
        sec06: [],
        archived: [],
      },
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
      conversationAgent: {
        id: 'agent-openclaw-main',
        name: 'OpenClaw Main',
        kind: 'openclaw',
        role: 'software engineer',
      },
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: [
        'overview',
        'conversations',
        'main-agent',
        'workflows',
        'memory',
        'files',
        'logs',
        'settings',
      ],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: {
        recentArtifacts: [],
      },
      projectBackendSettings: {
        effectiveBackend: 'openclaw-proxy',
        source: 'global',
      },
      mainAgent: {
        id: 'agent-openclaw-main',
        name: 'OpenClaw Main',
        kind: 'openclaw',
        role: 'software engineer',
      },
      mainProject: {
        id: 'proj-openclaw-main',
        workspace_dir: '/home/tom/code/ops-dashboard',
        memory_namespace: 'memory.proj-openclaw-main',
      },
      mainState: {
        openclaw_session_id: 'ses-main',
        openclaw_bootstrapped_at: '2026-03-27T17:00:00.000Z',
        openclaw_last_seen_at: '2026-03-27T17:01:00.000Z',
      },
      mainStats: {
        sessionCount: 4,
        messageCount: 22,
        artifactCount: 6,
      },
      recentFileChanges: [
        {
          status: 'M',
          status_label: 'Modified',
          file_path: 'src/app.js',
          updated_at: '2026-03-27T17:02:00.000Z',
          change_summary: '+12 -3',
          change_detail: '## Working tree\n@@ -1,2 +1,2 @@\n-old\n+new',
        },
      ],
    });

    assert.match(html, /data-active-tab="main-agent"/);
    assert.match(html, /OpenClaw Main/);
    assert.match(html, /data-openclaw-main-switch/);
    assert.match(html, /data-sidebar-toggle/);
    assert.match(html, /name="agent_id" value="agent-openclaw-main"/);
    assert.match(
      html,
      /<a class="tab [^"]*tab--utility[^"]*" href="\/project\/proj-main-agent\?tab=settings(?:&amp;session=ses-1)?">Settings<\/a>/,
    );
    assert.match(html, /<a class="btn" href="\/settings">Settings<\/a>/);
    assert.doesNotMatch(html, /Imported from/);
    assert.match(html, /Agent details/);
    assert.match(html, /Memory namespace/);
    assert.match(html, /proj-main-agent/);
    assert.match(html, /data-project-rail/);
    assert.match(html, /data-sidebar-default-collapsed="true"/);
    assert.doesNotMatch(html, /data-recent-files-root/);
    assert.doesNotMatch(html, /Recent files/);
    const openClawButtonIndex = html.indexOf('data-openclaw-main-switch');
    const logoutButtonIndex = html.indexOf('Logout');
    assert.ok(
      openClawButtonIndex > -1 &&
        logoutButtonIndex > -1 &&
        openClawButtonIndex < logoutButtonIndex,
    );
  });

  it('renders recent file diff details in the workspace changes rail', function () {
    const html = renderProjectTemplate({
      project: {
        id: 'proj-diff-rail',
        name: 'Diff Rail Project',
        description: 'Regression test project',
        status: 'active',
        created_at: '2026-03-27T17:00:00.000Z',
        last_activity: '2026-03-27T17:01:00.000Z',
        memory_namespace: 'memory.proj-diff-rail',
        workspace_dir: '/tmp/proj-diff-rail',
        sessions: [{ id: 'ses-1' }],
        workflows: [],
        agents: [
          {
            id: 'agent-openclaw-main',
            name: 'OpenClaw Main',
            kind: 'openclaw',
            role: 'software engineer',
          },
        ],
      },
      activeTab: 'conversations',
      activeSession: 'ses-1',
      currentSession: { id: 'ses-1', title: 'Session 1', state: 'active' },
      messages: [],
      logs: [],
      artifacts: [],
      agents: [
        {
          id: 'agent-openclaw-main',
          name: 'OpenClaw Main',
          kind: 'openclaw',
          role: 'software engineer',
        },
      ],
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: {
        recent: [],
        favourites: [],
        favorites: [],
        general: [],
        pave: [],
        sec06: [],
        archived: [],
      },
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
      conversationAgent: {
        id: 'agent-openclaw-main',
        name: 'OpenClaw Main',
        kind: 'openclaw',
        role: 'software engineer',
      },
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: [
        'overview',
        'conversations',
        'main-agent',
        'workflows',
        'memory',
        'files',
        'logs',
        'settings',
      ],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: {
        recentArtifacts: [],
      },
      projectBackendSettings: {
        effectiveBackend: 'openclaw-proxy',
        source: 'global',
      },
      recentFileChanges: [
        {
          status: 'M',
          status_label: 'Modified',
          file_path: 'src/app.js',
          updated_at: '2026-03-27T17:02:00.000Z',
          change_summary: '+12 -3',
          change_detail: '## Working tree\n@@ -1,2 +1,2 @@\n-old\n+new',
        },
        {
          status: 'M',
          status_label: 'Modified',
          file_path: 'src/view/project.ejs',
          updated_at: '2026-03-27T17:04:00.000Z',
          change_summary: '+120 -9',
          change_detail:
            'diff --git a/src/view/project.ejs b/src/view/project.ejs\n--- a/src/view/project.ejs\n+++ b/src/view/project.ejs\n@@ -1,2 +1,2 @@\n-old\n+new\n@@ -10,2 +10,2 @@\n-previous\n+current',
        },
      ],
    });

    assert.match(html, /Live changes/);
    assert.match(html, /data-recent-files-root/);
    assert.match(html, /## Working tree/);
    assert.match(html, /\+new/);
    assert.match(html, /Open full file/);
    assert.match(html, /file\?path=src%2Fview%2Fproject\.ejs/);
    assert.doesNotMatch(html, /## Truncated/);
    assert.doesNotMatch(html, /Diff preview clipped to stay readable/);
    assert.match(html, /recent-file-item__detail-body--diff/);
  });

  it('marks the clicked recent-files sort as selected in the markup state', function () {
    const html = renderProjectTemplate({
      project: {
        id: 'proj-sort-state',
        name: 'Sort State Project',
        description: 'Regression test project',
        status: 'active',
        created_at: '2026-03-27T17:00:00.000Z',
        last_activity: '2026-03-27T17:01:00.000Z',
        memory_namespace: 'memory.proj-sort-state',
        workspace_dir: '/tmp/proj-sort-state',
        sessions: [{ id: 'ses-1' }],
        workflows: [],
        agents: [
          {
            id: 'agent-openclaw-main',
            name: 'OpenClaw Main',
            kind: 'openclaw',
            role: 'software engineer',
          },
        ],
      },
      activeTab: 'conversations',
      activeSession: 'ses-1',
      currentSession: { id: 'ses-1', title: 'Session 1', state: 'active' },
      messages: [],
      logs: [],
      artifacts: [],
      agents: [
        {
          id: 'agent-openclaw-main',
          name: 'OpenClaw Main',
          kind: 'openclaw',
          role: 'software engineer',
        },
      ],
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: {
        recent: [],
        favourites: [],
        favorites: [],
        general: [],
        pave: [],
        sec06: [],
        archived: [],
      },
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
      conversationAgent: {
        id: 'agent-openclaw-main',
        name: 'OpenClaw Main',
        kind: 'openclaw',
        role: 'software engineer',
      },
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: [
        'overview',
        'conversations',
        'main-agent',
        'workflows',
        'memory',
        'files',
        'logs',
        'settings',
      ],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: {
        recentArtifacts: [],
      },
      projectBackendSettings: {
        effectiveBackend: 'openclaw-proxy',
        source: 'global',
      },
      recentFileSort: 'name:asc',
      recentFileChanges: [
        {
          status: 'M',
          status_label: 'Modified',
          file_path: 'src/app.js',
          updated_at: '2026-03-27T17:02:00.000Z',
          change_summary: '+12 -3',
          change_detail: '## Working tree\n@@ -1,2 +1,2 @@\n-old\n+new',
        },
      ],
    });

    assert.match(html, /data-recent-files-sort="name:asc"/);
    assert.match(html, /data-recent-files-sort-option="recent"[^>]*aria-selected="false"/);
    assert.match(html, /data-recent-files-sort-option="name"[^>]*aria-selected="true"/);
    assert.match(html, /data-recent-files-sort-option="path"[^>]*aria-selected="false"/);
    assert.match(html, /data-recent-files-sort-option="name"[\s\S]*?project-rail__sort-label">Name<\/span>[\s\S]*?project-rail__sort-arrow[^>]*>↓/);
  });

  it('renders truncated conversation messages with a single full-text expander', function () {
    const longText = 'x'.repeat(2600);
    const html = renderProjectTemplate({
      project: {
        id: 'proj-conversation-truncate',
        name: 'Conversation Truncate Project',
        description: 'Regression test project',
        status: 'active',
        created_at: '2026-03-27T17:00:00.000Z',
        last_activity: '2026-03-27T17:01:00.000Z',
        memory_namespace: 'memory.proj-conversation-truncate',
        workspace_dir: '/tmp/proj-conversation-truncate',
        sessions: [{ id: 'ses-1' }],
        workflows: [],
        agents: [
          {
            id: 'agent-openclaw-project-proj-conversation-truncate',
            name: 'OpenClaw Conversation',
            kind: 'openclaw',
            role: 'software engineer',
          },
        ],
      },
      activeTab: 'conversations',
      activeSession: 'ses-1',
      currentSession: { id: 'ses-1', title: 'Session 1', state: 'active' },
      messages: [
        {
          id: 'msg-1',
          direction: 'outbound',
          content: longText,
          created_at: '2026-03-27T17:02:00.000Z',
        },
      ],
      logs: [],
      artifacts: [],
      agents: [
        {
          id: 'agent-openclaw-project-proj-conversation-truncate',
          name: 'OpenClaw Conversation',
          kind: 'openclaw',
          role: 'software engineer',
        },
      ],
      conversationAgent: {
        id: 'agent-openclaw-project-proj-conversation-truncate',
        name: 'OpenClaw Conversation',
        kind: 'openclaw',
        role: 'software engineer',
      },
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: {
        recent: [],
        favourites: [],
        favorites: [],
        general: [],
        pave: [],
        sec06: [],
        archived: [],
      },
      stats: {
        sessionCount: 1,
        workflowCount: 0,
        agentCount: 1,
        messageCount: 1,
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
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: [
        'overview',
        'conversations',
        'main-agent',
        'workflows',
        'memory',
        'files',
        'logs',
        'settings',
      ],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: { recentArtifacts: [] },
      recentFileSort: 'recent:desc',
      recentFileChanges: [],
    });

    assert.match(html, /data-message-toggle[^>]*>show more<\/button>/);
    assert.match(html, /chat-bubble__body chat-bubble__body--preview" data-message-preview>x{2500}\.\.\.<\/pre>/);
    assert.match(html, /chat-bubble__body chat-bubble__body--full" data-message-full hidden>x{2600}<\/pre>/);
  });

  it('renders a project usage chart on the overview tab', function () {
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
        agents: [
          {
            id: 'agent-openclaw-main',
            name: 'OpenClaw Main',
            kind: 'openclaw',
            role: 'software engineer',
          },
        ],
      },
      activeTab: 'overview',
      activeSession: 'ses-1',
      currentSession: { id: 'ses-1', title: 'Session 1', state: 'active' },
      messages: [],
      logs: [],
      artifacts: [],
      agents: [
        {
          id: 'agent-openclaw-main',
          name: 'OpenClaw Main',
          kind: 'openclaw',
          role: 'software engineer',
        },
      ],
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: {
        recent: [],
        favourites: [],
        favorites: [],
        general: [],
        pave: [],
        sec06: [],
        archived: [],
      },
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
      conversationAgent: {
        id: 'agent-openclaw-main',
        name: 'OpenClaw Main',
        kind: 'openclaw',
        role: 'software engineer',
      },
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: [
        'overview',
        'conversations',
        'main-agent',
        'workflows',
        'memory',
        'files',
        'logs',
        'settings',
      ],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: {
        recentArtifacts: [],
        latestCommit: {
          hash: 'abcdef1234567890abcdef1234567890abcdef12',
          shortHash: 'abcdef1',
          branch: 'feature/overview-branch',
          author: 'Ops Dashboard',
          message: 'Update overview details',
          date: '2026-03-27T17:03:00.000Z',
          files: [
            {
              status: 'M',
              status_label: 'Modified',
              file_path: 'README.md',
              updated_at: '2026-03-27T17:03:00.000Z',
              change_summary: '+4 -2',
              change_detail: '## Working tree\n@@ -1,2 +1,2 @@\n-old\n+new',
            },
          ],
        },
      },
      recentFileChanges: [
        {
          status: 'M',
          status_label: 'Modified',
          file_path: 'README.md',
          updated_at: '2026-03-27T17:03:00.000Z',
          change_summary: '+4 -2',
          change_detail: '## Working tree\n@@ -1,2 +1,2 @@\n-old\n+new',
        },
      ],
      workspaceBranch: 'feature/overview-branch',
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
    assert.match(html, /Workspace details/);
    assert.match(html, /Project folder/);
    assert.match(html, /Current branch/);
    assert.match(html, /feature\/overview-branch/);
    assert.match(html, /Last commit/);
    assert.match(html, /Changed files/);
    assert.match(html, /README\.md/);
    assert.match(html, /data-project-rail/);
    assert.match(html, /data-project-rail-resize-handle/);
    assert.match(html, /Live changes/);
    assert.match(html, /data-recent-files-root/);
    assert.match(
      html,
      /data-recent-files-url="\/api\/project\/proj-overview-usage\/recent-files"/,
    );
    assert.match(html, /data-recent-files-sort-option="recent"/);
    assert.match(html, /data-recent-files-sort-option="name"/);
    assert.match(html, /data-recent-files-sort-option="path"/);
  });

  it('renders workspace settings fields and setup wizard', function () {
    const html = renderProjectTemplate({
      project: {
        id: 'proj-settings',
        name: 'Settings Project',
        description: 'Regression test project',
        status: 'active',
        created_at: '2026-03-27T17:00:00.000Z',
        last_activity: '2026-03-27T17:01:00.000Z',
        memory_namespace: 'memory.proj-settings',
        workspace_dir: '/tmp/proj-settings',
        sessions: [],
        workflows: [],
        agents: [
          {
            id: 'agent-openclaw-main',
            name: 'OpenClaw Main',
            kind: 'openclaw',
            role: 'software engineer',
          },
        ],
        settings_json: {
          code_folder: '/home/tom/code',
          subfolders: ['pave', 'sec'],
          ignore_folders: ['node_modules', 'dist'],
          getting_started: 'Read README.md first.',
        },
      },
      activeTab: 'settings',
      activeSession: '',
      currentSession: null,
      messages: [],
      logs: [],
      artifacts: [],
      agents: [
        {
          id: 'agent-openclaw-main',
          name: 'OpenClaw Main',
          kind: 'openclaw',
          role: 'software engineer',
        },
      ],
      planning: { currentState: [], now: [], health: [] },
      sidebarProjects: [],
      projectGroups: {
        recent: [],
        favourites: [],
        favorites: [],
        general: [],
        pave: [],
        sec06: [],
        archived: [],
      },
      stats: {
        sessionCount: 0,
        workflowCount: 0,
        agentCount: 1,
        messageCount: 0,
        logCount: 0,
        artifactCount: 0,
        activeSession: '',
        activeWorkflowCount: 0,
        idleWorkflowCount: 0,
        latestWorkflow: null,
        latestSession: null,
        latestMessage: null,
        latestLog: null,
        workflowStates: {},
        importedFrom: '',
      },
      conversationAgent: {
        id: 'agent-openclaw-main',
        name: 'OpenClaw Main',
        kind: 'openclaw',
        role: 'software engineer',
      },
      codexModel: 'gpt-5.3-codex',
      codexConfigured: false,
      projectTabs: [
        'overview',
        'conversations',
        'main-agent',
        'workflows',
        'memory',
        'files',
        'logs',
        'settings',
      ],
      workflowIdFromQuery: '',
      formatRelativeTime: (value) => value,
      formatDateTime: (value) => value,
      projectMemory: {
        recentArtifacts: [],
      },
      projectSettingsWizard: {
        codeFolder: '/home/tom/code',
        suggestedSubfolders: ['pave', 'sec'],
        commonIgnoreFolders: ['node_modules', 'dist', 'build'],
        starterInstructions: 'Read README.md first.',
      },
    });

    assert.match(html, /Workspace configuration/);
    assert.match(
      html,
      /<a class="tab [^"]*tab--utility[^"]*" href="\/project\/proj-settings\?tab=settings(?:&amp;session=ses-1)?">Settings<\/a>/,
    );
    assert.match(html, /name="code_folder"/);
    assert.match(html, /name="getting_started"/);
    assert.match(html, /Setup guide/);
    assert.match(html, /wizard_use_code_folder_btn/);
    assert.match(html, /wizard_fill_instructions_btn/);
    assert.doesNotMatch(html, /name="subfolders"/);
    assert.doesNotMatch(html, /name="ignore_folders"/);
    assert.doesNotMatch(html, /wizard_fill_subfolders_btn/);
    assert.doesNotMatch(html, /wizard_fill_ignores_btn/);
  });
});
