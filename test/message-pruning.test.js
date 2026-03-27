const { expect } = require('chai');

const { db } = require('../src/db');
const store = require('../src/store');

describe('Project message pruning', function() {
  before(function() {
    store.seedDefaults();
  });

  it('keeps only the latest 200 messages per project', function() {
    const project = store.createProject({ name: `prune-test-${Date.now()}` });
    const session = store.ensureSession(project.id, null, null);

    for (let i = 1; i <= 220; i += 1) {
      store.appendMessage({
        project_id: project.id,
        session_id: session.id,
        direction: 'outbound',
        message_type: 'prompt',
        priority: 'normal',
        payload: { text: `msg-${i}` },
        content: `msg-${i}`,
        status: 'ok'
      });
    }

    const count = db.prepare('SELECT COUNT(*) as n FROM messages WHERE project_id=?').get(project.id).n;
    expect(count).to.equal(200);

    const oldestKept = db
      .prepare('SELECT content FROM messages WHERE project_id=? ORDER BY created_at ASC, rowid ASC LIMIT 1')
      .get(project.id);
    expect(oldestKept.content).to.equal('msg-21');

    const newestKept = db
      .prepare('SELECT content FROM messages WHERE project_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(project.id);
    expect(newestKept.content).to.equal('msg-220');
  });
});
