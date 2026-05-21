const Database = require('better-sqlite3');
const path = require('path');

const JOBS_DB = path.join(__dirname, '..', 'data', 'jobs.db');

function recordFailure(jobName, error) {
    const db = new Database(JOBS_DB);
    try {
        const job = db.prepare('SELECT retries FROM jobs WHERE name = ?').get(jobName);
        const currentRetries = job ? job.retries : 0;
        const backoffMinutes = Math.pow(2, currentRetries);
        const nextRun = new Date(Date.now() + backoffMinutes * 60000).toISOString();
        db.prepare(`
            UPDATE jobs 
            SET retries = retries + 1,
                error_log = ?,
                next_run = ?
            WHERE name = ?
        `).run(error ? error.toString() : 'Unknown error', nextRun, jobName);
    } finally {
        db.close();
    }
}

function shouldRun(jobName) {
    const db = new Database(JOBS_DB);
    try {
        const job = db.prepare(`
            SELECT locked, retries, max_retries, next_run 
            FROM jobs 
            WHERE name = ?
        `).get(jobName);

        if (!job) return false;
        if (job.locked) return false;
        const maxRetries = job.max_retries !== null ? job.max_retries : 3;
        if (job.retries >= maxRetries) return false;
        if (job.next_run) {
            const nextRunTime = new Date(job.next_run).getTime();
            if (nextRunTime > Date.now()) return false;
        }
        return true;
    } finally {
        db.close();
    }
}

function resetJob(jobName) {
    const db = new Database(JOBS_DB);
    try {
        db.prepare(`
            UPDATE jobs 
            SET retries = 0,
                error_log = NULL,
                next_run = NULL
            WHERE name = ?
        `).run(jobName);
    } finally {
        db.close();
    }
}

function backfill(jobName, intervalMinutes) {
    const db = new Database(JOBS_DB);
    try {
        const job = db.prepare('SELECT last_run FROM jobs WHERE name = ?').get(jobName);
        if (!job || !job.last_run) return;

        const lastRunTime = new Date(job.last_run).getTime();
        const thresholdMs = (intervalMinutes + 5) * 60000;
        
        if (Date.now() - lastRunTime > thresholdMs) {
            const now = new Date().toISOString();
            db.prepare('UPDATE jobs SET next_run = ? WHERE name = ?').run(now, jobName);
        }
    } finally {
        db.close();
    }
}

module.exports = { recordFailure, shouldRun, resetJob, backfill };
