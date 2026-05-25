const Database = require('better-sqlite3');
const { Telegraf } = require('telegraf');
const path = require('path');

function preflight(dbPath, jobName) {
  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true, timeout: 5000 });
    const result = db.pragma('quick_check', { simple: true });
    if (result !== 'ok') {
      throw new Error(`Quick check failed: ${JSON.stringify(result)}`);
    }
    return true;
  } catch (error) {
    _logFailure(jobName, dbPath, error);
    return false;
  } finally {
    if (db && db.open) {
      try { db.close(); } catch (e) { }
    }
  }
}

function _logFailure(jobName, dbPath, error) {
  try {
    const jobsDbPath = path.join(__dirname, '..', 'data', 'jobs.db');
    const jobsDb = new Database(jobsDbPath, { timeout: 3000 });
    const updateStmt = jobsDb.prepare(`
      UPDATE jobs SET status = 'preflight_fail', error = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?
    `);
    const info = updateStmt.run(error.message, jobName);
    if (info.changes === 0) {
      const insertStmt = jobsDb.prepare(`
        INSERT INTO jobs (name, status, error, created_at, updated_at)
        VALUES (?, 'preflight_fail', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      insertStmt.run(jobName, error.message);
    }
    jobsDb.close();
  } catch (dbError) {
    console.error('[Preflight] Failed to log to jobs.db:', dbError.message);
  }
  try {
    if (process.env.TELEGRAM_TOKEN && process.env.OWNER_ID) {
      const tg = new Telegraf(process.env.TELEGRAM_TOKEN);
      const msg = `⚠️ DB Preflight Failed\nJob: ${jobName}\nDB: ${dbPath}\nError: ${error.message}`;
      tg.telegram.sendMessage(process.env.OWNER_ID, msg).catch(err => {
        console.error('[Preflight] Failed to send Telegram:', err.message);
      });
    }
  } catch (tgError) {
    console.error('[Preflight] Failed to init Telegram:', tgError.message);
  }
}

module.exports = { preflight };
