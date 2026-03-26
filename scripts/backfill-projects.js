const { initDb } = require('../src/db');
const store = require('../src/store');

initDb();
store.seedDefaults();

const imported = store.importProjectsFromDirectory('/home/tom/code');
console.log(`Imported/ensured ${imported.length} projects from /home/tom/code`);
for (const p of imported) {
  console.log(`- ${p.name} (${p.id})`);
}
