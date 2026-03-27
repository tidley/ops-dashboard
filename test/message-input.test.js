const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('message input', function() {
  let app;
  let store;
  let project;
  let tmpDir;

  before(async function() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-dashboard-test-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'dashboard.db');

    delete require.cache[require.resolve('../src/db')];
    delete require.cache[require.resolve('../src/store')];
    delete require.cache[require.resolve('../src/router')];
    delete require.cache[require.resolve('../src/planning')];
    delete require.cache[require.resolve('../src/app')];

    app = require('../src/app');
    store = require('../src/store');

    project = store.createProject({
      name: `Test Project ${Date.now()}`,
      description: 'Regression test project',
      tags: ['test'],
      settings: {},
    });
  });

  after(function() {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts form-encoded message input and returns JSON', async function() {
    const payload = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: 'Hello from the test',
        message_type: 'prompt',
      },
      acceptHeader: 'application/json',
    });

    assert.equal(payload.statusCode, 200);
    assert.equal(payload.kind, 'json');
    const body = payload.body;
    assert.equal(body.success, true);
    assert.equal(body.session_id.length > 0, true);
    assert.equal(Array.isArray(body.messages), true);
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].direction, 'outbound');
    assert.equal(body.messages[0].content, 'Hello from the test');
    assert.equal(body.messages[1].direction, 'inbound');
    // No longer using Echo agent; reply will vary. Just ensure inbound exists.
    assert.ok(body.messages[1].content && body.messages[1].content.length > 0);

    const state = store.getProjectState(project.id);
    assert.equal(state.last_tab, 'conversations');
    assert.equal(state.last_session_id, body.session_id);
  });

  it('redirects html submissions back to the project page', async function() {
    const result = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: 'Html submit',
        message_type: 'prompt',
      },
      acceptHeader: 'text/html',
    });

    assert.equal(result.statusCode, 302);
    assert.equal(result.kind, 'redirect');
    assert.match(result.location || '', new RegExp(`^/project/${project.id}\\?session=ses-`));
  });

  it('surfaces a readable error when OpenClaw is unavailable', async function() {
    const result = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: 'Check the fallback',
        message_type: 'prompt',
      },
      acceptHeader: 'application/json',
    });

    assert.equal(result.statusCode, 200);
    const payload = result.body;
    assert.equal(payload.success, true);
    assert.equal(payload.session_id.length > 0, true);
    assert.equal(Array.isArray(payload.messages), true);
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[1].status, 'error');
    assert.match(payload.messages[1].content, /OpenClaw binary not found/i);
    assert.match(payload.messages[1].error_text, /OpenClaw binary not found/i);
  });

  it('persists the outbound message before waiting on OpenClaw', async function() {
    const slowBin = path.join(tmpDir, 'slow-openclaw');
    fs.writeFileSync(slowBin, `#!/bin/sh
sleep 1
printf '%s' '{"reply":"delayed reply"}'
`);
    fs.chmodSync(slowBin, 0o755);

    const previousBin = process.env.OPENCLAW_BIN;
    try {
      process.env.OPENCLAW_BIN = slowBin;

      const request = app.processProjectMessage({
        projectId: project.id,
        body: {
          text: 'Persist me immediately',
          message_type: 'prompt',
          agent_id: 'agent-openclaw-main',
        },
        acceptHeader: 'application/json',
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      const messagesDuringRequest = store.listProjectMessages(project.id, 10);
      const queuedMessage = messagesDuringRequest.find((message) => message.direction === 'outbound' && message.content === 'Persist me immediately');
      assert.ok(queuedMessage, 'expected outbound message to be persisted before agent reply');
      assert.equal(queuedMessage.status, 'queued');

      const response = await request;
      assert.equal(response.statusCode, 200);
    } finally {
      if (previousBin) {
        process.env.OPENCLAW_BIN = previousBin;
      } else {
        delete process.env.OPENCLAW_BIN;
      }
    }
  });

  it('keeps conversation history in the same session when session_id is reused', async function() {
    const sessionId = `ses-history-${Date.now()}`;

    const first = await app.processProjectMessage({
      projectId: project.id,
      body: {
        session_id: sessionId,
        text: 'First persisted message',
        message_type: 'prompt',
      },
      acceptHeader: 'application/json',
    });

    const second = await app.processProjectMessage({
      projectId: project.id,
      body: {
        session_id: first.body.session_id,
        text: 'Second persisted message',
        message_type: 'prompt',
      },
      acceptHeader: 'application/json',
    });

    assert.equal(first.body.session_id, second.body.session_id);

    const messages = store.listMessages(project.id, first.body.session_id);
    assert.equal(messages.length, 4);
    assert.equal(messages[0].direction, 'outbound');
    assert.equal(messages[0].content, 'First persisted message');
    assert.equal(messages[2].direction, 'outbound');
    assert.equal(messages[2].content, 'Second persisted message');
  });

  it('rejects empty messages without persisting them', async function() {
    const before = store.listProjectMessages(project.id, 20).length;
    const result = await app.processProjectMessage({
      projectId: project.id,
      body: {
        text: '   ',
        message_type: 'prompt',
      },
      acceptHeader: 'application/json',
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error, 'empty_message');
    const after = store.listProjectMessages(project.id, 20).length;
    assert.equal(after, before);
  });
});
