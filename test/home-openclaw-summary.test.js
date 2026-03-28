const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

function renderTemplate(locals) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'src/views/index.ejs'), 'utf8');
  return ejs.render(template, locals, { filename: path.join(__dirname, '..', 'src/views/index.ejs') });
}

describe('home openclaw summary', function() {
  it('removes the overview panel and keeps the widened hero card', function() {
    const html = renderTemplate({
      projectGroups: {
        recent: [
          {
            id: 'recent-1',
            name: 'Recent Project',
            sectionLabel: 'General',
            status: 'active',
            session_count: 0,
            workflow_count: 0,
            activityLabel: '1h ago',
            favorite: false,
            archived: false,
            tags: [],
            created_at: '',
            last_activity: '',
          },
        ],
        favourites: [
          {
            id: 'fav-1',
            name: 'Favourite Project',
            sectionLabel: 'General',
            status: 'active',
            session_count: 0,
            workflow_count: 0,
            activityLabel: '2h ago',
            favorite: true,
            archived: false,
            tags: [],
            created_at: '',
            last_activity: '',
          },
        ],
        favorites: [],
        general: [],
        pave: [],
        sec06: [],
        archived: [],
      },
      projects: [],
      agents: [],
      dashboard: {
        projectCount: 1,
        activeProjectCount: 1,
        workflowCount: 0,
        sessionCount: 2,
        agentCount: 3,
      },
      usage: {
        aggregateTodayTotal: 12,
        aggregateWeeklyTotal: 34,
        aggregate30dTotal: 56,
        aggregate24hSeries: [],
        hourLabels: [],
        aggregate7dSeries: [],
        dayLabels: [],
        aggregate30dSeries: [],
        monthLabels: [],
        projectSummaries: [],
      },
      planning: { currentState: [], health: [], next: [] },
      featuredProject: null,
      openclawControl: {
        ok: true,
        summary: {
          gatewayBindMode: 'loopback',
          defaultModel: 'openai-codex/gpt-5.3-codex',
          fallbackModels: ['openrouter/stepfun/step-3.5-flash:free'],
          sessionCount: 486,
          runtimeVersion: '2026.3.24',
          configPath: '/home/tom/.openclaw/openclaw.json',
          gatewayBindHost: '127.0.0.1',
          gatewayPort: 18789,
          gatewayPortStatus: 'free',
          gatewayRpcOk: false,
          gatewayRpcError: 'gateway closed (1006 abnormal closure)',
          channelSummary: ['Nostr (NIP-17): configured'],
          authProviders: [{ provider: 'openai-codex', status: 'ok' }],
          gatewayConfigAuditIssues: [],
        },
      },
      openclawNotice: '',
      openclawError: '',
      formatRelativeTime: (value) => value,
    });

    assert.equal(/Live platform snapshot/.test(html), false);
    assert.equal(/The overview keeps to fleet health and agent traffic/.test(html), false);
    assert.match(html, /openclaw-summary-card/);
    assert.match(html, /<h2>Operations<\/h2>/);
    assert.match(html, /data-home-sidebar-lazy="true"/);
    assert.match(html, /<span class="sidebar-section__title">Pinned<\/span>\s*<span class="sidebar-section__count">\((?:1)\)<\/span>/);
    assert.match(html, /<span class="sidebar-section__title">Recent<\/span>\s*<span class="sidebar-section__count">\((?:1)\)<\/span>/);
    assert.match(html, /<span class="sidebar-section__title">Projects<\/span>\s*<span class="sidebar-section__count">\((?:0)\)<\/span>/);
    assert.match(html, /Loading recent projects…/);
    assert.doesNotMatch(html, /Recent Project/);
    assert.match(html, /data-sidebar-desktop-toggle/);
    assert.match(html, /data-sidebar-scroll/);
    assert.match(html, /home-sidebar\.js/);
  });
});
