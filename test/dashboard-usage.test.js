const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('dashboard usage stats', function() {
  let app;
  let store;
  let db;
  let tmpDir;
  let fixedNow;

  before(function() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-usage-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];
    delete require.cache[require.resolve('../src/app')];

    ({ db } = require('../src/db'));
    app = require('../src/app');
    store = require('../src/store');

    fixedNow = new Date(Date.UTC(2026, 2, 27, 15, 0, 0));
    const OriginalDate = Date;
    global.Date = class extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) {
          return new OriginalDate(fixedNow.getTime());
        }
        return new OriginalDate(...args);
      }
      static now() {
        return fixedNow.getTime();
      }
      static parse(value) {
        return OriginalDate.parse(value);
      }
      static UTC(...args) {
        return OriginalDate.UTC(...args);
      }
    };

    this._restoreDate = () => {
      global.Date = OriginalDate;
    };

    const projectA = store.createProject({
      name: 'Usage Alpha',
      description: 'Usage regression alpha',
      tags: ['test'],
      settings: {},
    });
    const projectB = store.createProject({
      name: 'Usage Beta',
      description: 'Usage regression beta',
      tags: ['test'],
      settings: {},
    });

    const insertLog = db.prepare('INSERT INTO logs (id,project_id,session_id,workflow_id,level,event_type,message,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const baseDay = '2026-03-27';
    insertLog.run('log-a-1', projectA.id, null, null, 'info', 'agent_route', 'usage', JSON.stringify({ usage: { input: 100, output: 20, total: 120 } }), `${baseDay}T02:00:00.000Z`);
    insertLog.run('log-a-2', projectA.id, null, null, 'info', 'codex_route', 'usage', JSON.stringify({ routed: { toolOutput: { response: { meta: { agentMeta: { usage: { input: 80, output: 10, total: 90 } } } } } } }), `${baseDay}T15:00:00.000Z`);
    insertLog.run('log-a-3', projectA.id, null, null, 'info', 'agent_route', 'usage', JSON.stringify({ usage: { input: 60, output: 12, total: 72 } }), '2026-03-26T10:00:00.000Z');
    insertLog.run('log-b-1', projectB.id, null, null, 'info', 'agent_route', 'usage', JSON.stringify({ usage: { input: 40, output: 5, total: 45 } }), `${baseDay}T08:00:00.000Z`);
    insertLog.run('log-b-2', projectB.id, null, null, 'info', 'agent_route', 'usage', JSON.stringify({ usage: { input: 280, output: 53, total: 333 } }), '2026-03-07T12:00:00.000Z');
  });

  after(function() {
    if (this._restoreDate) this._restoreDate();
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('aggregates usage by project and time bucket', function() {
    const usage = app.buildDashboardUsageStats(store.listProjects());

    assert.equal(usage.aggregateTodayTotal, 255);
    assert.equal(usage.aggregateWeeklyTotal, 327);
    assert.equal(usage.projectSummaries[0].name, 'Usage Alpha');
    assert.equal(usage.projectSummaries[0].todayTotal, 210);
    assert.equal(usage.projectSummaries[0].weeklyTotal, 282);
    assert.equal(usage.projectSummaries[1].name, 'Usage Beta');
    assert.equal(usage.projectSummaries[1].todayTotal, 45);
    assert.equal(usage.projectSummaries[1].weeklyTotal, 45);
    assert.equal(usage.projectSummaries[1].monthlyTotal, 378);
    assert.equal(usage.aggregate24hSeries[11], 120);
    assert.equal(usage.aggregate24hSeries[17], 45);
    assert.equal(usage.aggregate7dSeries.length, 7);
    assert.equal(usage.aggregate24hSeries.length, 24);
    assert.equal(usage.aggregate30dSeries.length, 30);
    assert.equal(usage.hourLabels.length, 24);
    assert.equal(usage.dayLabels.length, 7);
    assert.equal(usage.monthLabels.length, 30);
    assert.match(usage.hourLabels[0], /Mar 26, 15:00/);
    assert.match(usage.hourLabels[23], /Mar 27, 14:00/);
    assert.equal(usage.aggregate24hSeries[23], 0);
    assert.equal(usage.aggregate24hSeries[24], undefined);
    assert.equal(usage.aggregate30dTotal, 660);
    assert.equal(usage.aggregate30dSeries[usage.monthKeys.indexOf('2026-03-07')], 333);
  });
});
