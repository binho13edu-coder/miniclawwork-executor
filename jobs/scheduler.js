/**
 * jobs/scheduler.js — Schedule engine (V90-NEW-W)
 * Agendamentos recorrentes com persistencia SQLite
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const SCHEDULE_DB = path.join(__dirname, '..', 'data', 'scheduler.db');

function initDb() {
  const dir = path.dirname(SCHEDULE_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(SCHEDULE_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      cron TEXT NOT NULL,
      last_run TEXT,
      next_run TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(next_run, active);
  `);
  return db;
}

function addSchedule(userId, action, cronExpr) {
  const db = initDb();
  const now = new Date();
  let nextRun;
  
  // Parse simples: daily=HH:MM, weekly=DAY:HH:MM
  if (cronExpr.startsWith('daily=')) {
    const [h, m] = cronExpr.replace('daily=', '').split(':').map(Number);
    nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
  } else if (cronExpr.startsWith('weekly=')) {
    const [day, h, m] = cronExpr.replace('weekly=', '').split(':').map(Number);
    nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((day - now.getDay() + 7) % 7), h, m);
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 7);
  } else {
    db.close();
    return { error: 'Formato invalido. Use: daily=HH:MM ou weekly=DAY:HH:MM' };
  }
  
  const info = db.prepare('INSERT INTO schedules (user_id, action, cron, next_run) VALUES (?, ?, ?, ?)').run(userId, action, cronExpr, nextRun.toISOString());
  db.close();
  return { id: info.lastInsertRowid, nextRun: nextRun.toISOString() };
}

function listSchedules(userId) {
  const db = initDb();
  const rows = db.prepare('SELECT id, action, cron, next_run FROM schedules WHERE user_id = ? AND active = 1 ORDER BY next_run ASC').all(userId);
  db.close();
  return rows;
}

function deleteSchedule(id, userId) {
  const db = initDb();
  const row = db.prepare('SELECT id FROM schedules WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) { db.close(); return { ok: false, error: 'Nao encontrado' }; }
  db.prepare('UPDATE schedules SET active = 0 WHERE id = ?').run(id);
  db.close();
  return { ok: true };
}

function getDueSchedules() {
  const db = initDb();
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT * FROM schedules WHERE active = 1 AND next_run <= ?').all(now);
  db.close();
  return rows;
}

function updateNextRun(id, cronExpr) {
  const db = initDb();
  const now = new Date();
  let nextRun;
  
  if (cronExpr.startsWith('daily=')) {
    const [h, m] = cronExpr.replace('daily=', '').split(':').map(Number);
    nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
  } else if (cronExpr.startsWith('weekly=')) {
    const [day, h, m] = cronExpr.replace('weekly=', '').split(':').map(Number);
    nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((day - now.getDay() + 7) % 7), h, m);
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 7);
  }
  
  db.prepare('UPDATE schedules SET last_run = CURRENT_TIMESTAMP, next_run = ? WHERE id = ?').run(nextRun.toISOString(), id);
  db.close();
}

module.exports = { addSchedule, listSchedules, deleteSchedule, getDueSchedules, updateNextRun };
