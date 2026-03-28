#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('/home/tom/code/ops-dashboard/data/dashboard.db');
const rows = db.prepare('SELECT id, level, event_type, message, details_json FROM logs WHERE project_id=? ORDER BY created_at DESC LIMIT 1').all('proj-622cee69');
console.log('Logs count:', rows.length);
rows.forEach(row => {
  console.log('Raw details_json:', row.details_json);
});
db.close();