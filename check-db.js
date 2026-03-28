#!/usr/bin/env node
const Database = require('better-sqlite3');
const db = new Database('/home/tom/code/ops-dashboard/data/dashboard.db');
const row = db.prepare('SELECT * FROM projects WHERE name = ?').get('ops-dashboard');
console.log(JSON.stringify(row, null, 2));
db.close();