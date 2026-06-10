/**
 * jobs/reminder.js — Reminder engine (V90-NEW-R)
 * Verifica lembretes pendentes a cada 60s
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const REMINDERS_DB = path.join(__dirname, '..', 'data', 'reminders.db');

function initDb() {
  const dir = path.dirname(REMINDERS_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(REMINDERS_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      trigger_at TEXT NOT NULL,
      sent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_trigger ON reminders(trigger_at, sent);
  `);
  return db;
}

function addReminder(userId, message, minutes) {
  const db = initDb();
  const triggerAt = new Date(Date.now() + minutes * 60000).toISOString();
  const info = db.prepare('INSERT INTO reminders (user_id, message, trigger_at) VALUES (?, ?, ?)').run(userId, message, triggerAt);
  db.close();
  return { id: info.lastInsertRowid, triggerAt };
}

function getPending() {
  const db = initDb();
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT * FROM reminders WHERE sent = 0 AND trigger_at <= ? ORDER BY trigger_at ASC').all(now);
  db.close();
  return rows;
}

function markSent(id) {
  const db = initDb();
  db.prepare('UPDATE reminders SET sent = 1 WHERE id = ?').run(id);
  db.close();
}

function listReminders(userId) {
  const db = initDb();
  const rows = db.prepare('SELECT id, message, trigger_at FROM reminders WHERE user_id = ? AND sent = 0 ORDER BY trigger_at ASC').all(userId);
  db.close();
  return rows;
}

function deleteReminder(id, userId) {
  const db = initDb();
  const row = db.prepare('SELECT id FROM reminders WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) { db.close(); return { ok: false, error: 'Nao encontrado' }; }
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
  db.close();
  return { ok: true };
}

module.exports = { addReminder, getPending, markSent, listReminders, deleteReminder };
