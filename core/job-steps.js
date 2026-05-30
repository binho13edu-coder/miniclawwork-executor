const Database = require('better-sqlite3');
const path = require('path');

const JOBS_DB = path.join(__dirname, '..', 'data', 'jobs.db');

function initJobSteps() {
  try {
    const db = new Database(JOBS_DB);
    db.exec('CREATE TABLE IF NOT EXISTS job_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, step TEXT, status TEXT, detail TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP)');
    db.close();
    console.log('[job-steps] Tabela job_steps inicializada');
  } catch (e) {
    console.error('[job-steps] Erro ao inicializar tabela:', e.message);
  }
}

function logStep(jobId, step, status, detail = '') {
  try {
    const db = new Database(JOBS_DB);
    db.prepare('INSERT INTO job_steps (job_id, step, status, detail) VALUES (?, ?, ?, ?)').run(jobId, step, status, detail);
    db.close();
    console.log('[job-steps] ' + jobId + ' | ' + step + ': ' + status);
  } catch (e) {
    console.error('[job-steps] Erro ao logar step:', e.message);
  }
}

function getJobSteps(jobId) {
  try {
    const db = new Database(JOBS_DB);
    const rows = db.prepare('SELECT step, status, detail, ts FROM job_steps WHERE job_id = ? ORDER BY ts').all(jobId);
    db.close();
    return rows;
  } catch (e) {
    console.error('[job-steps] Erro ao buscar steps:', e.message);
    return [];
  }
}

function getLastJobSummary() {
  try {
    const db = new Database(JOBS_DB);
    const row = db.prepare('SELECT job_id FROM job_steps ORDER BY ts DESC LIMIT 1').get();
    const steps = db.prepare('SELECT step, status FROM job_steps WHERE job_id = ? ORDER BY ts').all(row.job_id);
    db.close();
    const total = steps.length;
    const ok = steps.filter(s => s.status === 'OK').length;
    const failed = steps.filter(s => s.status === 'FAIL').length;
    const failedSteps = steps.filter(s => s.status === 'FAIL').map(s => s.step).join(', ');
    return { jobId: row.job_id, total, ok, failed, failedSteps };
  } catch (e) {
    console.error('[job-steps] Erro ao buscar resumo:', e.message);
    return null;
  }
}

module.exports = { initJobSteps, logStep, getJobSteps, getLastJobSummary };
