const assert = require('assert');
const { buildProjectGroups } = require('../src/sidebar');

describe('sidebar grouping', function() {
  it('orders recent by last opened within 48 hours, keeps pinned projects out of recent, and separates archived projects', function() {
    const realNow = Date.now;
    Date.now = () => new Date('2026-03-28T12:00:00.000Z').getTime();

    const projects = [
      { id: 'a', name: 'Zulu', favorite: false, archived: false, section: 'general', ui_state: { last_opened_at: '2026-03-26T11:30:00.000Z' } },
      { id: 'b', name: 'Alpha', favorite: false, archived: false, section: 'general', ui_state: { last_opened_at: '2026-03-27T10:00:00.000Z' } },
      { id: 'c', name: 'Bravo', favorite: true, archived: false, section: 'general', ui_state: { last_opened_at: '2026-03-27T11:00:00.000Z' } },
      { id: 'd', name: 'Charlie', favorite: false, archived: false, section: 'general', ui_state: { last_opened_at: '2026-03-28T10:00:00.000Z' } },
      { id: 'e', name: 'Delta', favorite: false, archived: false, section: 'general', ui_state: { last_opened_at: '2026-03-27T09:00:00.000Z' } },
      { id: 'f', name: 'Echo', favorite: false, archived: false, section: 'general', ui_state: { last_opened_at: '2026-03-26T13:00:00.000Z' } },
      { id: 'g', name: 'Foxtrot', favorite: false, archived: false, section: 'general', ui_state: { last_opened_at: '2026-03-26T12:30:00.000Z' } },
      { id: 'h', name: 'Pave One', favorite: false, archived: false, section: 'pave', ui_state: { last_opened_at: '2026-03-28T11:00:00.000Z' } },
      { id: 'i', name: 'Old Archive', favorite: false, archived: true, section: 'general', ui_state: { last_opened_at: '2026-03-24T08:00:00.000Z' } },
      { id: 'j', name: 'Recent Archive', favorite: false, archived: true, section: 'pave', ui_state: { last_opened_at: '2026-03-27T14:00:00.000Z' } },
    ];

    try {
      const groups = buildProjectGroups(projects);

      assert.deepStrictEqual(groups.recent.map(project => project.id), ['h', 'd', 'b', 'e', 'f', 'g']);
      assert.deepStrictEqual(groups.favourites.map(project => project.id), ['c']);
      assert.deepStrictEqual(groups.general.map(project => project.id), ['a']);
      assert.deepStrictEqual(groups.pave.map(project => project.id), []);
      assert.deepStrictEqual(groups.archived.map(project => project.id), ['j', 'i']);
      assert.equal(groups.recent.some(project => project.id === 'c'), false);
      assert.equal(groups.favourites.some(project => project.id === 'i'), false);
    } finally {
      Date.now = realNow;
    }
  });
});
