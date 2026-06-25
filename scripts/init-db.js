// init-db.js — garante schema jobs.db em qualquer deploy
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'jobs.db'));

db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      TEXT UNIQUE NOT NULL,
  user_id      TEXT NOT NULL,
  status       TEXT DEFAULT 'pending',
  plan_json    TEXT,
  current_step INTEGER DEFAULT 0,
  total_steps  INTEGER DEFAULT 0,
  result       TEXT,
  error        TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
)`).run();

console.log('OK — tasks table ready');
db.close();
